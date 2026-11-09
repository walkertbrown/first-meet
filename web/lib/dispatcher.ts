// The dispatcher (plan 3.9 step 2): every 2 s, in the web service, it keeps enough workers
// alive for the attempts waiting, within this service's run-start and CPU budgets a minute
// and never past WORKERS_MAX alive. A Postgres advisory lock means one instance dispatches.
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { events, judgeWorkers } from '@/db/schema';
import { expireLeases, giveUpWaiting } from '@/lib/queue';

export const LOCK_KEY = 0x46_4d_44_31; // "FMD1"
/** The Workflow's instance: 2 CPU, so each run start uses 2 of the CPU budget (3.9). */
export const CPU_PER_RUN = 2;
/** After a failed start: 5 s, 15 s, 45 s, then every 2 minutes (3.9 step 4). */
export const BACKOFF_S = [5, 15, 45, 120];

export type Budgets = { runStartsPerMin: number; cpuPerMin: number; workersMax: number };

export const budgetsFromEnv = (env = process.env): Budgets => ({
  runStartsPerMin: Number(env.RUN_STARTS_PER_MIN ?? 10),
  cpuPerMin: Number(env.CPU_PER_MIN ?? 4),
  workersMax: Number(env.WORKERS_MAX ?? 30),
});

/** Starting and checking Workflow runs: Render's REST API, or a stand-in in the tests. */
export interface Runner {
  start(workerId: string): Promise<{ ok: true; runId: string } | { ok: false; status: number; error: string }>;
  /** Render's status for a run: 'pending' | 'running' | 'completed' | 'failed' | 'canceled' … */
  status(runId: string): Promise<string | null>;
}

/** Render's Workflow API: the two calls the Render SDK's startTask and getTaskRun make. */
export class RenderRunner implements Runner {
  constructor(private key = process.env.RENDER_API_KEY ?? '', private slug = process.env.JUDGE_WORKFLOW_SLUG ?? '', private base = 'https://api.render.com/v1') {}

  async start(workerId: string) {
    try {
      const res = await fetch(`${this.base}/task-runs`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ task: `${this.slug}/find_poses`, input: [workerId] }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json().catch(() => null) as { id?: string; message?: string } | null;
      if (!res.ok || !body?.id) return { ok: false as const, status: res.status, error: body?.message ?? `HTTP ${res.status}` };
      return { ok: true as const, runId: body.id };
    } catch (e) {
      return { ok: false as const, status: 0, error: (e as Error).message };
    }
  }

  async status(runId: string) {
    try {
      const res = await fetch(`${this.base}/task-runs/${encodeURIComponent(runId)}`, {
        headers: { authorization: `Bearer ${this.key}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      return ((await res.json()) as { status?: string }).status ?? null;
    } catch { return null; }
  }
}

export type TickResult = {
  locked: boolean;
  waiting: number; starting: number; idle: number; alive: number;
  started: string[]; failed: number; requeued: string[]; closeCalls: string[];
  blockedBy?: 'run_starts' | 'cpu' | 'workers_max' | 'backoff';
};

/** In this process: the failed-start backoff. */
const backoff = { failures: 0, until: 0 };
export const resetBackoff = () => { backoff.failures = 0; backoff.until = 0; };

const n = (v: unknown) => Number(v ?? 0);

export async function tick(db: Db, runner: Runner, budgets: Budgets, now = () => Date.now()): Promise<TickResult> {
  return db.transaction(async tx => {
    const [{ locked }] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(${LOCK_KEY}) as locked`);
    const out: TickResult = { locked, waiting: 0, starting: 0, idle: 0, alive: 0, started: [], failed: 0, requeued: [], closeCalls: [] };
    if (!locked) return out;
    const txDb = tx as unknown as Db;

    const leases = await expireLeases(txDb);
    out.requeued = leases.requeued;
    out.closeCalls = leases.closeCalls;

    // No longer alive: seen more than 60 s ago while holding nothing (3.9 step 4).
    await tx.execute(sql`
      update judge_workers w set ended_at = now()
      where ended_at is null and last_seen_at < now() - interval '60 seconds'
        and not exists (select 1 from judge_queue q where q.worker_id = w.worker_id)`);

    // A worker that hasn't asked for work 2 minutes after it started: ask Render about it.
    const late = await tx.execute<{ worker_id: string; run_id: string | null }>(sql`
      select worker_id, run_id from judge_workers
      where ended_at is null and last_seen_at is null and started_at < now() - interval '2 minutes'
        and (checked_at is null or checked_at < now() - interval '30 seconds')`);
    for (const w of late) {
      const s = w.run_id ? await runner.status(w.run_id) : 'failed';
      if (s && ['failed', 'canceled', 'cancelled', 'completed', 'succeeded'].includes(s)) {
        await tx.execute(sql`update judge_workers set ended_at = now(), checked_at = now() where worker_id = ${w.worker_id}`);
        await tx.insert(events).values({ kind: 'worker_failed', detail: { worker_id: w.worker_id, run_id: w.run_id, status: s } });
      } else {
        await tx.execute(sql`update judge_workers set checked_at = now() where worker_id = ${w.worker_id}`);
      }
    }

    const [c] = await tx.execute<{ waiting: number; starting: number; idle: number; alive: number; starts: number }>(sql`
      select
        (select count(*) from judge_queue where kind = 'poses' and worker_id is null and next_try_at <= now()) as waiting,
        (select count(*) from judge_workers where ended_at is null and last_seen_at is null) as starting,
        (select count(*) from judge_workers where ended_at is null and idle_at > now() - interval '2 seconds'
           and not exists (select 1 from judge_queue q where q.worker_id = judge_workers.worker_id)) as idle,
        (select count(*) from judge_workers where ended_at is null) as alive,
        (select count(*) from events where kind = 'run_start' and at > now() - interval '60 seconds') as starts`);
    out.waiting = n(c.waiting); out.starting = n(c.starting); out.idle = n(c.idle); out.alive = n(c.alive);
    let want = out.waiting - out.starting - out.idle;
    if (want <= 0) return out;

    if (backoff.until > now()) { out.blockedBy = 'backoff'; return out; }
    const startsLeft = budgets.runStartsPerMin - n(c.starts);
    const cpuLeft = Math.floor((budgets.cpuPerMin - n(c.starts) * CPU_PER_RUN) / CPU_PER_RUN);
    const aliveLeft = budgets.workersMax - out.alive;
    const can = Math.min(startsLeft, cpuLeft, aliveLeft);
    if (want > can) {
      out.blockedBy = can === aliveLeft ? 'workers_max' : can === cpuLeft ? 'cpu' : 'run_starts';
      want = Math.max(0, can);
    }

    for (let i = 0; i < want; i++) {
      const workerId = `w-${randomBytes(6).toString('hex')}`;
      await tx.insert(judgeWorkers).values({ workerId });
      const r = await runner.start(workerId);
      if (r.ok) {
        await tx.execute(sql`update judge_workers set run_id = ${r.runId} where worker_id = ${workerId}`);
        await tx.insert(events).values({ kind: 'run_start', detail: { worker_id: workerId, run_id: r.runId } });
        out.started.push(workerId);
        backoff.failures = 0;
      } else {
        await tx.execute(sql`update judge_workers set ended_at = now() where worker_id = ${workerId}`);
        await tx.insert(events).values({ kind: 'run_start_failed', detail: { worker_id: workerId, status: r.status, error: r.error.slice(0, 200) } });
        console.log(JSON.stringify({ msg: 'run start failed', status: r.status, error: r.error.slice(0, 200) }));
        out.failed++;
        backoff.until = now() + BACKOFF_S[Math.min(backoff.failures, BACKOFF_S.length - 1)] * 1000;
        backoff.failures++;
        break;
      }
    }
    if (backoff.failures > 0) out.closeCalls.push(...await giveUpWaiting(txDb));
    return out;
  });
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Starts the 2-second loop once per process (called from instrumentation.ts). */
export function startDispatcher(db: Db, runner: Runner = new RenderRunner(), budgets = budgetsFromEnv(), everyMs = 2000) {
  if (timer) return;
  let busy = false;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await tick(db, runner, budgets);
      if (r.started.length || r.failed || r.requeued.length || r.closeCalls.length) console.log(JSON.stringify({ msg: 'dispatch', ...r }));
      for (const id of [...r.requeued, ...r.closeCalls]) {
        await db.execute(sql`select pg_notify('fm_live', ${JSON.stringify({ kind: 'attempt', attempt_id: id, status: 'changed' })})`);
      }
    } catch (e) {
      console.log(JSON.stringify({ msg: 'dispatch error', error: (e as Error).message }));
    } finally {
      busy = false;
    }
  }, everyMs);
  timer.unref?.();
}

export function stopDispatcher() {
  if (timer) clearInterval(timer);
  timer = null;
}
