// What the lifter's phone needs about one of her attempts while she waits for lights
// (plan 5.25 steps 8–9), and the wait estimate she sees after 90 s (3.9 step 8).
import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts } from '@/db/schema';
import { judgedLift } from '@/lib/queue';
import { nearSide, type Frame, type Pt, type Side } from '@/lib/judge/pose';
import type { R2 } from '@/lib/r2';

export type AttemptState = {
  id: string;
  status: string;
  lift: string;
  /** The lift the judge ran: a sample clip's own lift (5.36), else the attempt's. */
  shown_lift: string;
  number: number;
  weight: number;
  reps_declared: number | null;
  call: 'white' | 'red' | 'close' | null;
  lights: ('white' | 'red')[] | null;
  reason: string | null;
  /** Home: the rep the red reason is for ("REP <k> · <REASON>"). */
  red_rep: number | null;
  sample: boolean;
  /** The judged moment, ms from the recording's start: the frozen frame after the lights. */
  judged_frame_ms: number | null;
  /** Whole minutes, once she has waited 90 s (3.9 step 8). Null while judging is paused. */
  wait_minutes: number | null;
  /** With the wait: 3.9 step 9's state (item 87). While `paused`, no minutes are shown. */
  judging?: Judging | null;
};

const WAITING = ['queued', 'judging'];

export async function attemptState(db: Db, id: string, lifterId: string, withWait = false): Promise<{ status: 200; attempt: AttemptState } | { status: 403 | 404; error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 404, error: 'no such attempt' };
  const [a] = await db.select().from(attempts).where(eq(attempts.id, id));
  if (!a) return { status: 404, error: 'no such attempt' };
  if (a.lifterId !== lifterId) return { status: 403, error: 'not your attempt' };
  const m = (a.measures ?? {}) as { red_rep?: number };
  return {
    status: 200,
    attempt: {
      id: a.id, status: a.status, lift: a.lift, shown_lift: judgedLift(a), number: a.number, weight: a.weight, reps_declared: a.repsDeclared,
      call: a.call, lights: (a.lights as AttemptState['lights']) ?? null, reason: a.reason,
      red_rep: typeof m.red_rep === 'number' ? m.red_rep : null, sample: a.isSampleClip, judged_frame_ms: a.judgedFrameMs ?? null,
      ...(withWait && WAITING.includes(a.status)
        ? await judgingState(db, a.id).then(j => ({ wait_minutes: j.minutes, judging: j.state }))
        : { wait_minutes: null, judging: null }),
    },
  };
}

/**
 * 3.9 step 8 (item 87): the clip seconds queued ahead of hers ÷ the clip seconds finished a minute
 * + the median pose time, rounded up to whole minutes, never less than 1.
 * - The rate is over the last 5 complete *busy* minutes in 24 hours: minutes in which a `poses`
 *   row was waiting or being judged (from each judged attempt's `uploaded` to its `judged`, and
 *   the rows queued now). Quiet minutes say nothing about how fast the judges go, so they're skipped.
 * - With no busy minute (or none of them finished anything), a minute of clip is taken as a minute to judge.
 * - The median pose time: the last 15 minutes, then 24 hours, then 30 s.
 * With no attempt (the status page), the estimate is for a clip arriving now.
 */
export async function waitMinutes(db: Db, attemptId?: string): Promise<number> {
  const mine = attemptId
    ? sql`(select enqueued_at from judge_queue where attempt_id = ${attemptId} and kind = 'poses')`
    : sql`now()`;
  const [r] = await db.execute<{ ahead: number; finished: number; minutes: number; median: number | null }>(sql`
    with spans as (
      select (select min(u.at) from events u where u.kind = 'uploaded' and u.attempt_id = j.attempt_id) as s, j.at as e
        from events j where j.kind = 'judged' and j.at > now() - interval '24 hours'
      union all
      select enqueued_at, now() from judge_queue where kind = 'poses'
    ), busy as (
      select distinct g as m from spans,
        generate_series(date_trunc('minute', greatest(coalesce(s, e), now() - interval '24 hours')), date_trunc('minute', e), interval '1 minute') g
      where g < date_trunc('minute', now())
    ), last5 as (select m from busy order by m desc limit 5)
    select
      (select coalesce(sum(q.clip_seconds), 0) from judge_queue q
         where q.kind = 'poses' and q.enqueued_at < coalesce(${mine}, now())) as ahead,
      (select coalesce(sum((e.detail->>'clip_s')::float), 0) from events e, last5
         where e.kind = 'judged' and date_trunc('minute', e.at) = last5.m) as finished,
      (select count(*) from last5) as minutes,
      coalesce(
        (select percentile_cont(0.5) within group (order by (detail->>'pose_secs')::float) from events
           where kind = 'judged' and at > now() - interval '15 minutes' and detail->>'pose_secs' is not null),
        (select percentile_cont(0.5) within group (order by (detail->>'pose_secs')::float) from events
           where kind = 'judged' and at > now() - interval '24 hours' and detail->>'pose_secs' is not null)) as median`);
  return estimateMinutes(Number(r.ahead), Number(r.finished), r.median === null ? null : Number(r.median), Number(r.minutes));
}

/**
 * The arithmetic of 3.9 step 8. `finishedS`: the clip seconds finished over `busyMinutes` busy
 * minutes (5, or fewer in a young 24 hours). It never divides by 0: with no busy minute, or nothing
 * finished in them, a minute of clip takes a minute.
 */
export function estimateMinutes(aheadS: number, finishedS: number, medianPoseS: number | null, busyMinutes = 5) {
  const perMin = busyMinutes > 0 ? finishedS / busyMinutes : 0;
  const queueMin = perMin > 0 ? aheadS / perMin : aheadS / 60;
  const m = Math.ceil(queueMin + (medianPoseS ?? 30) / 60);
  return Number.isFinite(m) ? Math.max(1, m) : 1;
}

export type Judging = 'normal' | 'busy' | 'paused';

/**
 * 3.9 step 9 (item 87): judging is paused when `poses` rows are waiting and either starting
 * workers is failing (the newest start failed, and nothing has been judged since), or nothing has
 * been judged for 3 minutes while one has waited longer than 3. It ends with the next attempt
 * judged. Otherwise `busy` when the estimate is 2 minutes or more, else `normal`. The held breath
 * (5.25 step 8), her total page (5.28) and the status page (5.7) all read this one function.
 */
export async function judgingState(db: Db, attemptId?: string): Promise<{ state: Judging; minutes: number | null }> {
  if (await judgingPaused(db)) return { state: 'paused', minutes: null };
  const minutes = await waitMinutes(db, attemptId);
  return { state: minutes >= 2 ? 'busy' : 'normal', minutes };
}

export async function judgingPaused(db: Db): Promise<boolean> {
  const [r] = await db.execute<{ paused: boolean }>(sql`
    -- waiting or being judged: a row held by a worker that died still waits
    with w as (select min(enqueued_at) as oldest from judge_queue where kind = 'poses'),
    t as (
      select
        (select max(at) from events where kind = 'judged') as judged,
        (select max(at) from events where kind = 'run_start') as started,
        (select max(at) from events where kind = 'run_start_failed') as failed
    )
    select coalesce((select oldest from w) is not null and (
      (t.failed is not null and (t.started is null or t.failed > t.started) and (t.judged is null or t.judged < t.failed))
      or ((t.judged is null or t.judged < now() - interval '3 minutes') and (select oldest from w) < now() - interval '3 minutes')
    ), false) as paused from t`);
  return !!r?.paused;
}

/** What her clip needs to hold the judged frame with its marks (5.25 step 10) after a reload or from the banner. */
export type JudgedFrame = { clip_url: string; ms: number; p: Pt[]; side: Side };

/**
 * Her own judged attempt's frame: a short link to her clip, and the pose the judge saw at the
 * judged moment (points are fractions of the frame), so the phone needs no pose model to mark it.
 */
export async function judgedFrame(db: Db, store: Pick<R2, 'signedGet' | 'getJson'>, id: string, lifterId: string):
  Promise<{ status: 200; frame: JudgedFrame } | { status: 403 | 404; error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 404, error: 'no such attempt' };
  const [a] = await db.select().from(attempts).where(eq(attempts.id, id));
  if (!a) return { status: 404, error: 'no such attempt' };
  if (a.lifterId !== lifterId) return { status: 403, error: 'not your attempt' };
  if (!a.videoKey || !a.posesKey || a.judgedFrameMs === null || !a.call) return { status: 404, error: 'not judged yet' };
  const poses = await store.getJson<{ frames: Frame[] }>(a.posesKey);
  const ms = a.judgedFrameMs;
  let best: Frame | null = null;
  for (const f of poses?.frames ?? []) if (f.p && (!best || Math.abs(f.t - ms) < Math.abs(best.t - ms))) best = f;
  if (!best?.p) return { status: 404, error: 'no pose at the judged frame' };
  const m = (a.measures ?? {}) as { side?: Side };
  return { status: 200, frame: { clip_url: await store.signedGet(a.videoKey), ms, p: best.p, side: m.side ?? nearSide(best) } };
}
