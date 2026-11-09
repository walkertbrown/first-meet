// What the lifter's phone needs about one of her attempts while she waits for lights
// (plan 5.25 steps 8–9), and the wait estimate she sees after 90 s (3.9 step 8).
import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts } from '@/db/schema';

export type AttemptState = {
  id: string;
  status: string;
  lift: string;
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
  /** Whole minutes, once she has waited 90 s (3.9 step 8). */
  wait_minutes: number | null;
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
      id: a.id, status: a.status, lift: a.lift, number: a.number, weight: a.weight, reps_declared: a.repsDeclared,
      call: a.call, lights: (a.lights as AttemptState['lights']) ?? null, reason: a.reason,
      red_rep: typeof m.red_rep === 'number' ? m.red_rep : null, sample: a.isSampleClip, judged_frame_ms: a.judgedFrameMs ?? null,
      wait_minutes: withWait && WAITING.includes(a.status) ? await waitMinutes(db, a.id) : null,
    },
  };
}

/**
 * 3.9 step 8: the clip seconds queued ahead of hers ÷ the clip seconds finished a minute (over
 * the last 5 minutes) + the median pose time over 15 minutes, rounded up to whole minutes.
 * With nothing finished in 5 minutes, a minute of clip is taken as a minute to judge, and with no
 * pose times, 30 s; never less than 1.
 */
export async function waitMinutes(db: Db, attemptId: string): Promise<number> {
  const [r] = await db.execute<{ ahead: number; done5: number; median: number | null }>(sql`
    with mine as (select enqueued_at from judge_queue where attempt_id = ${attemptId} and kind = 'poses')
    select
      (select coalesce(sum(q.clip_seconds), 0) from judge_queue q, mine
         where q.kind = 'poses' and q.enqueued_at < mine.enqueued_at) as ahead,
      (select coalesce(sum((detail->>'clip_s')::float), 0) from events
         where kind = 'judged' and at > now() - interval '5 minutes') as done5,
      (select percentile_cont(0.5) within group (order by (detail->>'pose_secs')::float) from events
         where kind = 'judged' and at > now() - interval '15 minutes' and detail->>'pose_secs' is not null) as median`);
  return estimateMinutes(Number(r.ahead), Number(r.done5), r.median === null ? null : Number(r.median));
}

export function estimateMinutes(aheadS: number, done5S: number, medianPoseS: number | null) {
  const perMin = done5S / 5;
  const queueMin = perMin > 0 ? aheadS / perMin : aheadS / 60;
  return Math.max(1, Math.ceil(queueMin + (medianPoseS ?? 30) / 60));
}
