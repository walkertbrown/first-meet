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
    /** 2.4: the phone's pose time ÷ frames judged, median by device (look 5.14: "over" past 220 ms). */
    poseRunByDevice: { device: string; medianMs: number; clips: number }[];
  };
  /** 2.4, 3.4b: the bar's own call next to the referees' on real meet bench attempts, and how often the bench went wrong. */
  bench: {
    decided: number; agree: number; whiteOnRed: number; redOnWhite: number;
    filmings: number; pressWhileSinking: number; lostAfterStart: number; noStartVoids: number;
    /** 3.4c: real meet Home press sets decided or waiting, and those that went to a referee (a close call). */
    homePressSets: number; homePressReferee: number;
  };
  render: {
    workersLive: number; startedHour: number; failedHour: number; attemptsPerWorker: number | null; requeuedHour: number;
    startsLastMin: number; startsHour: number; http429Hour: number;
  };
  meet: { onPlatform: number };
  /** 2.4: the last 24 hours' uploads tried and failed or refused, by device (most uploads first). */
  uploads: { device: string; tried: number; failed: number }[];
  demo: { runsToday: number; runsLimit: number; waiting: number; closeCalls: number; onPlatform: number; lights15mMedian: number | null };
  errors: { at: string; kind: string; attemptId: string | null; text: string }[];
  commits: { web: string | null; judge: string | null };
};

const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// 2.2 "Which attempts count" (item 94). Lines about lights, calls and referees count real meets only: the demo
// referee isn't a referee and a sample's call is known. Lines about phones count every filming from a real phone,
// the demo and test meets included, never a sample (it isn't filmed on her phone). Lines about the server count
// every run, samples included.
/** Lights, calls and referees: a real meet's own filming. Needs `a` (attempts) and `m` (meets). */
export const REAL_MEET = sql`(m.kind = 'real' and not a.is_sample_clip)`;
/** The phone's own lines: any filming from a real phone, never a sample. Needs `a` and `m`. */
export const REAL_PHONE = sql`(m.kind in ('real', 'demo', 'test') and not a.is_sample_clip)`;

/** An attempt is "on the platform" while it's being recorded, sent or judged, or was declared in the last 10 minutes. */
const ON_PLATFORM = sql`(a.status in ('recording', 'uploading', 'queued', 'judging') or (a.status = 'declared' and a.created_at > now() - interval '10 minutes'))`;

export async function opsNumbers(db: Db, budgets: Budgets, webCommit = process.env.NEXT_PUBLIC_COMMIT ?? null): Promise<OpsNumbers> {
  const [q] = await db.execute<Record<string, unknown>>(sql`
    select
      -- the server: every run waits in the same queue, samples included
      count(*) as waiting,
      extract(epoch from now() - min(q.enqueued_at))::int as oldest_s,
      count(*) filter (where m.kind = 'demo') as demo_waiting
    from judge_queue q join attempts a on a.id = q.attempt_id join meets m on m.id = a.meet_id
    where q.kind = 'poses'`);
  const [cc] = await db.execute<Record<string, unknown>>(sql`
    select count(*) filter (where ${REAL_MEET}) as real, count(*) filter (where m.kind = 'demo') as demo
    from attempts a join meets m on m.id = a.meet_id where a.status = 'close_call'`);

  // upload to lights is the server's: every run, samples included; the demo's own line is its part
  const lights = (since: string, demo: boolean) => db.execute<Record<string, unknown>>(sql`
    select
      percentile_cont(0.5) within group (order by (e.detail->>'upload_to_lights_s')::float) as median,
      percentile_cont(0.95) within group (order by (e.detail->>'upload_to_lights_s')::float) as p95,
      count(*) as n
    from events e join attempts a on a.id = e.attempt_id join meets m on m.id = a.meet_id
    where e.kind = 'judged' and e.at > now() - ${since}::interval and e.detail->>'upload_to_lights_s' is not null
      and ${demo ? sql`m.kind = 'demo'` : sql`true`}`);
  const [l15] = await lights('15 minutes', false);
  const [l24] = await lights('24 hours', false);
  const [d15] = await lights('15 minutes', true);

  const [pose] = await db.execute<Record<string, unknown>>(sql`
    select percentile_cont(0.5) within group (order by (detail->>'pose_secs')::float) as median
    from events where kind = 'judged' and at > now() - interval '24 hours' and detail->>'pose_secs' is not null`);
  const phone = await db.execute<Record<string, unknown>>(sql`
    select detail->>'device' as device, percentile_cont(0.5) within group (order by (detail->>'poseMs')::float) as median, count(*) as n
    from events where kind = 'phone_judge_time' and at > now() - interval '30 days' and detail->>'poseMs' is not null
      and detail->>'source' = 'camera'
    group by 1 order by n desc, device limit 20`);

  const poseRun = await db.execute<Record<string, unknown>>(sql`
    select detail->>'device' as device,
      percentile_cont(0.5) within group (order by (detail->>'poseMs')::float / (detail->>'frames')::float) as median, count(*) as n
    from events where kind = 'phone_judge_time' and at > now() - interval '30 days' and detail->>'source' = 'camera'
      and detail->>'poseMs' is not null and (detail->>'frames')::float > 0
    group by 1 order by n desc, device limit 20`);

  // 2.4, 3.4b "Bench, phone and referees". Barbell bench attempts only (a Home `bench` is the overhead press,
  // 3.4c, and is never a bench here). The referee lines count real meets only; the tracker's three rates are the
  // phone's, so they count every bench filmed on a real phone, the demo and test meets included, never a sample.
  // Decided: a referee gave the lights. The bar's call is `shadow_lights` (three of one colour, or none when it
  // called a close call, which agrees with neither colour and is never a wrong light).
  // The last three are over every filming of a bench attempt: one that uploaded, or one voided with no Start!.
  const [b] = await db.execute<Record<string, unknown>>(sql`
    with b as (
      select a.*, ${REAL_MEET} as real_meet from attempts a join meets m on m.id = a.meet_id join lifters l on l.id = a.lifter_id
      where a.lift = 'bench' and ${REAL_PHONE} and l.division <> 'home'
    ), press as (
      -- 3.4c: real meet Home press sets the phone or a referee has decided, or that wait for a referee
      select a.status, a.measures from attempts a join meets m on m.id = a.meet_id join lifters l on l.id = a.lifter_id
      where a.lift = 'bench' and ${REAL_MEET} and l.division = 'home' and a.status in ('judged', 'close_call')
    ), decided as (
      select call, shadow_lights->>0 as shadow from b
      where real_meet and status = 'judged' and (measures->>'referee')::boolean is true
    )
    select
      (select count(*) from decided) as decided,
      (select count(*) from decided where shadow = call) as agree,
      (select count(*) from decided where shadow = 'white' and call = 'red') as white_on_red,
      (select count(*) from decided where shadow = 'red' and call = 'white') as red_on_white,
      (select count(*) from b where uploaded_at is not null) as uploaded,
      (select count(*) from b where (measures->>'press_while_sinking')::boolean is true) as sinking,
      (select count(*) from b where (measures->>'lost_after_start')::boolean is true) as lost,
      (select count(*) from events e join b r on r.id = e.attempt_id where e.kind = 'lost_bar_void') as voids,
      (select count(*) from press) as press_sets,
      (select count(*) from press where status = 'close_call' or (measures->>'referee')::boolean is true) as press_referee`);

  // 2.4: uploads in the last 24 hours that failed or were refused, against all uploads, by device: every real
  // phone's, the demo and test meets included, never a sample (none is uploaded from a phone).
  // An upload tried is a started upload, or one the phone turned down before it began (too big).
  // A failure's device is its own, or else its upload's.
  const up = await db.execute<Record<string, unknown>>(sql`
    with tried as (
      select coalesce(detail->>'device', 'unknown') as device from events
      where at > now() - interval '24 hours'
        and (kind = 'upload_started' or (kind = 'upload_failed' and (detail->>'before_start')::boolean))
        and not exists (select 1 from attempts x where x.id = attempt_id and x.is_sample_clip)
    ), failed as (
      select coalesce(e.detail->>'device',
        (select s.detail->>'device' from events s where s.kind = 'upload_started' and s.attempt_id = e.attempt_id and s.at <= e.at order by s.at desc limit 1),
        'unknown') as device
      from events e where e.kind in ('upload_refused', 'upload_failed') and e.at > now() - interval '24 hours'
        and not exists (select 1 from attempts x where x.id = e.attempt_id and x.is_sample_clip)
    )
    select device, sum(t)::int as tried, sum(f)::int as failed from (
      select device, 1 as t, 0 as f from tried union all select device, 0, 1 from failed
    ) x group by device order by tried desc, device limit 20`);

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
      poseRunByDevice: poseRun.map(x => ({ device: String(x.device ?? 'unknown'), medianMs: num(x.median), clips: num(x.n) })),
    },
    bench: {
      decided: num(b?.decided), agree: num(b?.agree), whiteOnRed: num(b?.white_on_red), redOnWhite: num(b?.red_on_white),
      filmings: num(b?.uploaded) + num(b?.voids), pressWhileSinking: num(b?.sinking), lostAfterStart: num(b?.lost), noStartVoids: num(b?.voids),
      homePressSets: num(b?.press_sets), homePressReferee: num(b?.press_referee),
    },
    render: {
      workersLive: num(r.live), startedHour: num(r.started_hour), failedHour: num(r.failed_hour),
      attemptsPerWorker: numOrNull(r.per_worker), requeuedHour: num(r.requeued_hour),
      startsLastMin: num(r.starts_min), startsHour: num(r.started_hour), http429Hour: num(r.http429_hour),
    },
    meet: { onPlatform: num(p?.real) },
    uploads: up.map(x => ({ device: String(x.device ?? 'unknown'), tried: num(x.tried), failed: num(x.failed) })),
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

/** "2 of 40 · 5%": failed or refused against all, with the share. */
export const failedOf = (failed: number, tried: number) =>
  `${failed} of ${tried}${tried ? ` · ${Math.round((failed / Math.max(tried, failed)) * 100)}%` : ''}`;

/** Section 9: uploads failing more than 5% of the time are "over" (look 5.14). */
export const UPLOADS_OVER = 0.05;
/** Piece 2: a phone's pose run past 220 ms is "over" (look 5.14). */
export const POSE_RUN_OVER_MS = 220;

/** 2.4: failed or refused uploads in the last 24 hours, all devices, then each device. */
export function uploadRows(u: OpsNumbers['uploads']): OpsRow[] {
  const tried = u.reduce((a, x) => a + x.tried, 0), failed = u.reduce((a, x) => a + x.failed, 0);
  const over = (f: number, t: number) => t > 0 && f / Math.max(t, f) > UPLOADS_OVER;
  return [
    { label: 'Uploads failed or refused, 24 h', value: failedOf(failed, tried), over: over(failed, tried) },
    ...u.map(x => ({ label: `Failed or refused · ${x.device}`, value: failedOf(x.failed, x.tried), over: over(x.failed, x.tried) })),
  ];
}

/** 2.4: "Pose run per frame", median by device, "over" past 220 ms. */
export function poseRunRows(p: OpsNumbers['speed']['poseRunByDevice']): OpsRow[] {
  if (!p.length) return [{ label: 'Pose run per frame', value: '—' }];
  return p.map(d => ({
    label: `Pose run per frame · ${d.device} (${d.clips} ${d.clips === 1 ? 'clip' : 'clips'})`,
    value: `${Math.round(d.medianMs)} ms`, over: d.medianMs > POSE_RUN_OVER_MS,
  }));
}

/** 2.4, 3.4b: "Bench, phone and referees". */
export function benchRows(b: OpsNumbers['bench']): OpsRow[] {
  return [
    { label: 'Decided', value: String(b.decided) },
    { label: 'Agree', value: String(b.agree) },
    { label: 'White on a red', value: String(b.whiteOnRed) },
    { label: 'Red on a white', value: String(b.redOnWhite) },
    { label: 'Press! while sinking', value: failedOf(b.pressWhileSinking, b.filmings) },
    { label: 'Lost the bar after Start!', value: failedOf(b.lostAfterStart, b.filmings) },
    { label: 'No Start!, filmed again', value: failedOf(b.noStartVoids, b.filmings) },
    // 3.4c: "Home press sets to a referee · <x>%"
    { label: 'Home press sets to a referee', value: b.homePressSets ? `${Math.round((b.homePressReferee / b.homePressSets) * 100)}%` : '—' },
  ];
}

/** `over`: the figure is past its line (look 5.14: `--no-text` at 700, then the word "over"; never lamp red). */
export type OpsRow = { label: string; value: string; over?: boolean };
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
      ...poseRunRows(n.speed.poseRunByDevice),
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
    { eyebrow: 'UPLOADS', rows: uploadRows(n.uploads) },
    { eyebrow: 'BENCH, PHONE AND REFEREES', rows: benchRows(n.bench) },
    { eyebrow: 'DEMO', rows: [
      { label: 'Demo runs today', value: `${n.demo.runsToday} of ${n.demo.runsLimit}` },
      { label: 'On the platform now', value: String(n.demo.onPlatform) },
      { label: 'Waiting', value: String(n.demo.waiting) },
      { label: 'Close calls waiting', value: String(n.demo.closeCalls) },
      { label: 'Upload to lights, median, 15 min', value: secs(n.demo.lights15mMedian) },
    ] },
  ];
}
