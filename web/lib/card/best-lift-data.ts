// "YOUR BEST LIFT" on the bomb-out page (plan 5.28, item 101) from the database: her best good attempt, its
// clip's state and length, and "Try again" (item 102) for this clip, which has no card.
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, meets } from '@/db/schema';
import type { LifterRow } from '@/lib/meet-flow';
import type { Units } from '@/lib/meet';
import { bestLiftView, type BestLiftView } from '@/lib/card/best-lift';
import { clipState } from '@/lib/card/card-data';
import { clipLength, clipLiftOf, clipWindow, retryClip } from '@/lib/card/clip-job';

export type BestLift = {
  attemptId: string;
  view: BestLiftView;
  /** the clip's length in ms, for "Play · 0:14" */
  lengthMs: number;
  ready: boolean;
  failed: null | 'retry' | 'final';
};

/** Her best lift's block, or null when she didn't bomb out, or bombed out with no good attempt (none of it shows). */
export async function bestLiftFor(db: Db, l: LifterRow, now = new Date()): Promise<BestLift | null> {
  const it = await clipLiftOf(db, l, now);
  if (!it?.bombed || !it.top.id) return null;
  const [a] = await db.select().from(attempts).where(eq(attempts.id, it.top.id));
  if (!a) return null;
  const [m] = l.meetId ? await db.select({ name: meets.name }).from(meets).where(eq(meets.id, l.meetId)) : [];
  const w = clipWindow({ call: a.call, repLights: a.repLights, commandTimes: a.commandTimes });
  const st = clipState({ attemptId: a.id, status: a.clipStatus, key: a.clipKey, sharedAt: null, retried: a.clipRetried });
  return {
    attemptId: a.id,
    view: bestLiftView({ ...l, units: l.units as Units }, m?.name ?? null, a),
    lengthMs: clipLength(w.endMs - w.startMs),
    ...st,
  };
}

/** "Try again" on her best lift's clip: queued once more, once (item 102). */
export async function retryBestLift(db: Db, l: LifterRow): Promise<boolean> {
  const b = await bestLiftFor(db, l);
  return !!b && b.failed === 'retry' && retryClip(db, l.id, b.attemptId);
}
