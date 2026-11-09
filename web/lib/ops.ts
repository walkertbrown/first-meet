// /ops (plan 2.4 and 5.39): the numbers that say how the judge is running, read from Postgres.
// Demo attempts count only under DEMO (5.36), so QUEUE, SPEED and MEET leave them out.
import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { CPU_PER_RUN, type Budgets } from '@/lib/dispatcher';
import { demoLimits, demoRunsToday } from '@/lib/demo';

/** Events that count as errors on /ops. */
export const ERROR_KINDS = ['run_start_failed', 'worker_failed', 'requeued', 'error'] as const;

export type OpsNumbers = {
  queue: { waiting: number; oldestS: number | null; closeCalls: number };
  speed: {
    lights15m: { median: number | null; p95: number | null; n: number };
    lights24h: { median: number | null; p95: number | null; n: number };
    poseSecsMedian: number | null;
    phoneByDevice: { device: string; medianMs: number; clips: number }[];
  };
  render: {
    workersLive: number; startedHour: number; failedHour: number; attemptsPerWorker: number | null; requeuedHour: number;
    startsLastMin: number; startsHour: number; http429Hour: number;
  };
  meet: { onPlatform: number };
  demo: { runsToday: number; runsLimit: number; waiting: number; closeCalls: number; onPlatform: number; lights15mMedian: number | null };
  errors: { at: string; kind: string; attemptId: string | null; text: string }[];
  commits: { web: string | null; judge: string | null };
};

const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** An attempt is "on the platform" while it's being recorded, sent or judged, or was declared in the last 10 minutes. */
const ON_PLATFORM = sql`(a.status in ('recording', 'uploading', 'queued', 'judging') or (a.status = 'declared' and a.created_at > now() - interval '10 minutes'))`;

export async function opsNumbers(db: Db, budgets: Budgets, webCommit = process.env.NEXT_PUBLIC_COMMIT ?? null): Promise<OpsNumbers> {
  const [q] = await db.execute<Record<string, unknown>>(sql`
    select
      count(*) filter (where m.kind <> 'demo') as waiting,
      extract(epoch from now() - min(q.enqueued_at) filter (where m.kind <> 'demo'))::int as oldest_s,
      count(*) filter (where m.kind = 'demo') as demo_waiting
    from judge_queue q join attempts a on a.id = q.attempt_id join meets m on m.id = a.meet_id
    where q.kind = 'poses'`);
  const [cc] = await db.execute<Record<string, unknown>>(sql`
    select count(*) filter (where m.kind <> 'demo') as real, count(*) filter (where m.kind = 'demo') as demo
    from attempts a join meets m on m.id = a.meet_id where a.status = 'close_call'`);

  const lights = (since: string, demo: boolean) => db.execute<Record<string, unknown>>(sql`
    select
      percentile_cont(0.5) within group (order by (e.detail->>'upload_to_lights_s')::float) as median,
      percentile_cont(0.95) within group (order by (e.detail->>'upload_to_lights_s')::float) as p95,
      count(*) as n
    from events e join attempts a on a.id = e.attempt_id join meets m on m.id = a.meet_id
    where e.kind = 'judged' and e.at > now() - ${since}::interval and e.detail->>'upload_to_lights_s' is not null
      and ${demo ? sql`m.kind = 'demo'` : sql`m.kind <> 'demo'`}`);
  const [l15] = await lights('15 minutes', false);
  const [l24] = await lights('24 hours', false);
  const [d15] = await lights('15 minutes', true);

  const [pose] = await db.execute<Record<string, unknown>>(sql`
    select percentile_cont(0.5) within group (order by (detail->>'pose_secs')::float) as median
    from events where kind = 'judged' and at > now() - interval '24 hours' and detail->>'pose_secs' is not null`);
  const phone = await db.execute<Record<string, unknown>>(sql`
    select detail->>'device' as device, percentile_cont(0.5) within group (order by (detail->>'poseMs')::float) as median, count(*) as n
    from events where kind = 'phone_judge_time' and at > now() - interval '30 days' and detail->>'poseMs' is not null
    group by 1 order by n desc, device limit 20`);

  const [r] = await db.execute<Record<string, unknown>>(sql`
    select
      (select count(*) from judge_workers where ended_at is null) as live,
      (select count(*) from events where kind = 'run_start' and at > now() - interval '1 hour') as started_hour,
      (select count(*) from events where kind in ('run_start_failed', 'worker_failed') and at > now() - interval '1 hour') as failed_hour,
      (select avg(attempts_done) from judge_workers where started_at > now() - interval '24 hours' and (ended_at is not null or attempts_done > 0)) as per_worker,
      (select count(*) from events where kind = 'requeued' and at > now() - interval '1 hour') as requeued_hour,
      (select count(*) from events where kind = 'run_start' and at > now() - interval '60 seconds') as starts_min,
      (select count(*) from events where kind = 'run_start_failed' and detail->>'status' = '429' and at > now() - interval '1 hour') as http429_hour`);

  const [p] = await db.execute<Record<string, unknown>>(sql`
    select count(distinct a.lifter_id) filter (where m.kind <> 'demo') as real, count(distinct a.lifter_id) filter (where m.kind = 'demo') as demo
    from attempts a join meets m on m.id = a.meet_id where ${ON_PLATFORM}`);

  const errs = await db.execute<{ at: Date | string; kind: string; attempt_id: string | null; detail: Record<string, unknown> | null }>(sql`
    select at, kind, attempt_id, detail from events
    where kind in (${sql.join(ERROR_KINDS.map(k => sql`${k}`), sql`, `)})
       or (kind = 'close_call' and detail->>'reason' = 'judge_unavailable')
    order by at desc, id desc limit 20`);

  const [jc] = await db.execute<{ commit: string | null }>(sql`
    select commit from (
      select detail->>'commit' as commit, at from events where kind = 'judged' and detail->>'commit' is not null
      union all
      select commit, coalesce(ended_at, last_seen_at, started_at) as at from judge_workers where commit is not null
    ) c order by at desc limit 1`);

  return {
    queue: { waiting: num(q?.waiting), oldestS: numOrNull(q?.oldest_s), closeCalls: num(cc?.real) },
    speed: {
      lights15m: { median: numOrNull(l15?.median), p95: numOrNull(l15?.p95), n: num(l15?.n) },
      lights24h: { median: numOrNull(l24?.median), p95: numOrNull(l24?.p95), n: num(l24?.n) },
      poseSecsMedian: numOrNull(pose?.median),
      phoneByDevice: phone.map(x => ({ device: String(x.device ?? 'unknown'), medianMs: num(x.median), clips: num(x.n) })),
    },
    render: {
      workersLive: num(r.live), startedHour: num(r.started_hour), failedHour: num(r.failed_hour),
      attemptsPerWorker: numOrNull(r.per_worker), requeuedHour: num(r.requeued_hour),
      startsLastMin: num(r.starts_min), startsHour: num(r.started_hour), http429Hour: num(r.http429_hour),
    },
    meet: { onPlatform: num(p?.real) },
    demo: {
      runsToday: (await demoRunsToday(db, '')).all, runsLimit: demoLimits().perDay,
      waiting: num(q?.demo_waiting), closeCalls: num(cc?.demo), onPlatform: num(p?.demo), lights15mMedian: numOrNull(d15?.median),
    },
    errors: errs.map(e => ({ at: new Date(e.at).toISOString(), kind: e.kind, attemptId: e.attempt_id, text: errorText(e.kind, e.detail) })),
    commits: { web: webCommit ? webCommit.slice(0, 7) : null, judge: jc?.commit ? jc.commit.slice(0, 7) : null },
  };
}

/** One short line about an error event. */
export function errorText(kind: string, d: Record<string, unknown> | null): string {
  switch (kind) {
    case 'run_start_failed': return `Run start failed${d?.status ? ` (${d.status})` : ''}${d?.error ? `: ${String(d.error).slice(0, 120)}` : ''}`;
    case 'worker_failed': return `Worker ${d?.worker_id ?? ''} ended without asking for work (${d?.status ?? 'unknown'})`.replace('  ', ' ');
    case 'requeued': return 'A lease ran out; the attempt went back in the queue';
    case 'close_call': return `Close call, the judge couldn't run${d?.why ? `: ${d.why}` : ''}`;
    default: return d?.message ? String(d.message).slice(0, 160) : kind;
  }
}

/** "Judge and web are on different commits" (2.1), when both are known and differ. */
export const commitsDiffer = (c: OpsNumbers['commits']) => !!c.web && !!c.judge && c.web !== 'unknown' && c.web.slice(0, 7) !== c.judge.slice(0, 7);

const secs = (s: number | null) => (s === null ? '—' : s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const mins = (s: number | null) => (s === null ? '—' : `${Math.max(1, Math.round(s / 60))} min`);

export type OpsRow = { label: string; value: string };
export type OpsSection = { eyebrow: string; rows: OpsRow[] };

/** The sections, each row a label and a number ("Waiting · 12", "Oldest · 3 min"). */
export function opsSections(n: OpsNumbers, budgets: Budgets): OpsSection[] {
  const hourStarts = budgets.runStartsPerMin * 60, hourCpu = budgets.cpuPerMin * 60;
  return [
    { eyebrow: 'QUEUE', rows: [
      { label: 'Waiting', value: String(n.queue.waiting) },
      { label: 'Oldest', value: n.queue.waiting ? mins(n.queue.oldestS) : '—' },
      { label: 'Close calls waiting', value: String(n.queue.closeCalls) },
    ] },
    { eyebrow: 'SPEED', rows: [
      { label: 'Upload to lights, median, 15 min', value: secs(n.speed.lights15m.median) },
      { label: 'Upload to lights, 95th percentile, 15 min', value: secs(n.speed.lights15m.p95) },
      { label: 'Upload to lights, median, 24 h', value: secs(n.speed.lights24h.median) },
      { label: 'Upload to lights, 95th percentile, 24 h', value: secs(n.speed.lights24h.p95) },
      { label: 'Pose time per clip, median', value: secs(n.speed.poseSecsMedian) },
      ...n.speed.phoneByDevice.map(d => ({ label: `Phone judge time · ${d.device} (${d.clips} ${d.clips === 1 ? 'clip' : 'clips'})`, value: secs(d.medianMs / 1000) })),
    ] },
    { eyebrow: 'RENDER', rows: [
      { label: 'Workers live', value: String(n.render.workersLive) },
      { label: 'Workers started this hour', value: String(n.render.startedHour) },
      { label: 'Workers failed this hour', value: String(n.render.failedHour) },
      { label: 'Attempts per worker', value: n.render.attemptsPerWorker === null ? '—' : n.render.attemptsPerWorker.toFixed(1) },
      { label: 'Leases ran out this hour', value: String(n.render.requeuedHour) },
      { label: 'Run starts, last minute', value: `${n.render.startsLastMin} of ${budgets.runStartsPerMin}` },
      { label: 'Run starts this hour', value: `${n.render.startsHour} of ${hourStarts}` },
      { label: 'CPU, last minute', value: `${n.render.startsLastMin * CPU_PER_RUN} of ${budgets.cpuPerMin}` },
      { label: 'CPU this hour', value: `${n.render.startsHour * CPU_PER_RUN} of ${hourCpu}` },
      { label: '429s this hour', value: String(n.render.http429Hour) },
      { label: 'Web commit', value: n.commits.web ?? 'unknown' },
      { label: 'Judge commit', value: n.commits.judge ?? 'none yet' },
    ] },
    { eyebrow: 'MEET', rows: [
      { label: 'On the platform now', value: String(n.meet.onPlatform) },
    ] },
    { eyebrow: 'DEMO', rows: [
      { label: 'Demo runs today', value: `${n.demo.runsToday} of ${n.demo.runsLimit}` },
      { label: 'On the platform now', value: String(n.demo.onPlatform) },
      { label: 'Waiting', value: String(n.demo.waiting) },
      { label: 'Close calls waiting', value: String(n.demo.closeCalls) },
      { label: 'Upload to lights, median, 15 min', value: secs(n.demo.lights15mMedian) },
    ] },
  ];
}
