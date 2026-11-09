// The dispatcher (3.9 step 2): workers for what's waiting, within the budgets, one instance at a time.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, events, judgeQueue, judgeWorkers } from '../../web/db/schema';
import { LOCK_KEY, resetBackoff, tick, type Runner } from '../../web/lib/dispatcher';
import { markUploaded } from '../../web/lib/queue';
import { freshDb, MemStore, seed, URL_ } from './setup';

class FakeRunner implements Runner {
  starts: string[] = [];
  fail: { status: number; error: string } | null = null;
  statuses = new Map<string, string>();
  async start(workerId: string) {
    if (this.fail) return { ok: false as const, ...this.fail };
    this.starts.push(workerId);
    return { ok: true as const, runId: `run-${workerId}` };
  }
  async status(runId: string) { return this.statuses.get(runId) ?? 'running'; }
}

const CT = { loaded: 0, squat: 2000, rack: 6000 };
const BIG = { runStartsPerMin: 100, cpuPerMin: 200, workersMax: 100 };

describe.skipIf(!URL_)('the dispatcher', () => {
  let db: Db, drop: () => Promise<void>;
  const store = new MemStore();
  beforeAll(async () => ({ db, drop } = await freshDb()));
  afterAll(async () => drop?.());
  beforeEach(async () => {
    resetBackoff();
    await db.delete(judgeQueue); await db.delete(judgeWorkers); await db.delete(events); await db.delete(attempts);
  });
  const queue = async (n: number) => { const { attempts: ids } = await seed(db, store, n); for (const id of ids) await markUploaded(db, store, id, CT); return ids; };

  it('starts one worker for each attempt waiting, and no more on the next tick', async () => {
    await queue(3);
    const r = new FakeRunner();
    const t1 = await tick(db, r, BIG);
    expect(t1).toMatchObject({ locked: true, waiting: 3, started: expect.any(Array) });
    expect(r.starts).toHaveLength(3);
    const rows = await db.select().from(judgeWorkers);
    expect(rows.every(w => w.runId === `run-${w.workerId}`)).toBe(true);
    const t2 = await tick(db, r, BIG);
    expect(t2.starting).toBe(3);
    expect(r.starts).toHaveLength(3);
  });

  it('an idle worker counts against what is waiting', async () => {
    await queue(2);
    await db.insert(judgeWorkers).values({ workerId: 'w-idle', lastSeenAt: new Date(), idleAt: new Date() });
    const r = new FakeRunner();
    await tick(db, r, BIG);
    expect(r.starts).toHaveLength(1);
  });

  it('never starts more than the run-start budget a minute', async () => {
    await queue(8);
    const r = new FakeRunner();
    const t = await tick(db, r, { ...BIG, runStartsPerMin: 5 });
    expect(r.starts).toHaveLength(5);
    expect(t.blockedBy).toBe('run_starts');
    // the next tick, inside the same minute, starts none
    await db.update(judgeWorkers).set({ endedAt: new Date() });
    await tick(db, r, { ...BIG, runStartsPerMin: 5 });
    expect(r.starts).toHaveLength(5);
  });

  it('never past the CPU budget: 2 CPU a run, so CPU_PER_MIN 4 is 2 starts', async () => {
    await queue(5);
    const r = new FakeRunner();
    const t = await tick(db, r, { ...BIG, cpuPerMin: 4 });
    expect(r.starts).toHaveLength(2);
    expect(t.blockedBy).toBe('cpu');
  });

  it('never more than WORKERS_MAX alive', async () => {
    await queue(6);
    await db.insert(judgeWorkers).values([{ workerId: 'a', lastSeenAt: new Date() }, { workerId: 'b', lastSeenAt: new Date() }]);
    const r = new FakeRunner();
    const t = await tick(db, r, { ...BIG, workersMax: 4 });
    expect(r.starts).toHaveLength(2);
    expect(t.blockedBy).toBe('workers_max');
  });

  it('a refused start (429): logged, backs off 5 s, and starts again after', async () => {
    await queue(2);
    const r = new FakeRunner();
    r.fail = { status: 429, error: 'rate limited' };
    let clock = Date.now();
    const t1 = await tick(db, r, BIG, () => clock);
    expect(t1.failed).toBe(1);
    const [ev] = await db.select().from(events).where(sql`kind = 'run_start_failed'`);
    expect(ev.detail).toMatchObject({ status: 429 });
    r.fail = null;
    clock += 3000;
    expect((await tick(db, r, BIG, () => clock)).blockedBy).toBe('backoff');
    expect(r.starts).toHaveLength(0);
    clock += 3000;
    await tick(db, r, BIG, () => clock);
    expect(r.starts).toHaveLength(2);
  });

  it('a worker that never asks: Render says it failed, so it is ended and another starts', async () => {
    await queue(1);
    await db.insert(judgeWorkers).values({ workerId: 'w-stuck', runId: 'run-stuck', startedAt: new Date(Date.now() - 3 * 60_000) });
    const r = new FakeRunner();
    r.statuses.set('run-stuck', 'failed');
    await tick(db, r, BIG);
    const [w] = await db.select().from(judgeWorkers).where(sql`worker_id = 'w-stuck'`);
    expect(w.endedAt).not.toBeNull();
    expect(r.starts).toHaveLength(1);
  });

  it('one instance dispatches: a second one, while the lock is held, does nothing', async () => {
    await queue(2);
    const r = new FakeRunner();
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
      const other = await tick(db, r, BIG);
      expect(other.locked).toBe(false);
    });
    expect(r.starts).toHaveLength(0);
  });
});
