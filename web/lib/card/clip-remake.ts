// Item 119 (held for Walker's yes, behind ITEM_119=on): her clip is made again when its end card changes.
// - When: her made clip's end card (her Story) no longer matches her card, after a late clip or a referee's
//   change (3.8, 5.33). It's queued again 60 s after the last change, so a run of changes makes one run; a
//   change put back before then makes none. "Make the board final" sweeps once for any that still differ.
// - While it's made again: the old clip stays `ready`, playable and shareable at the same link; the new one
//   replaces it at the same key.
// - If it fails: two tries (item 102), then she keeps the old clip with no line, and /ops names it.
// - The line: if she had tapped Share or Save to my phone on the old clip, her Clip segment says so, until
//   she taps one of them on the new one.
// About a total only: a bomb-out has no card, and its end frame moves only with her best lift (piece 7).
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, judgeQueue, lifters } from '@/db/schema';
import { cardFor } from '@/lib/card/card-data';
import { endCardHash } from '@/lib/card/card-hash';
import { clipLength, clipWindow } from '@/lib/card/clip-job';
import { logEvent } from '@/lib/queue';

/** Off until approved/plan.md has item 119. */
export const remakeOn = (env: Record<string, string | undefined> = process.env) => env.ITEM_119 === 'on';

/** A run of changes makes one run: the clip is made again this long after the last one. */
export const REMAKE_AFTER_MS = 60_000;

export { endCardHash };

/**
 * Her card's made clip, if its end card differs from her card now. A clip made before item 119 has no hash:
 * what it ends on isn't known, so it's left as it is (switching item 119 on doesn't make every clip again).
 */
async function clipNow(db: Db, lifterId: string, now: Date) {
  const [l] = await db.select().from(lifters).where(eq(lifters.id, lifterId));
  if (!l || l.deletedAt) return null;
  const card = await cardFor(db, l, now);
  const c = card?.clip;
  if (!card || !c || c.status !== 'ready' || !c.cardHash) return null;
  const [a] = await db.select({ failed: attempts.clipRemakeFailed }).from(attempts).where(eq(attempts.id, c.attemptId));
  return { attemptId: c.attemptId, same: c.cardHash === endCardHash(card.view), failed: a?.failed ?? false };
}

/**
 * Queues her clip to be made again at `at`, or moves a waiting one to `at`. A run already making it is left
 * alone: when it lands, takeClip compares again. `tries`: 2 (item 102's two), or 1 for "Try again" and the
 * board's sweep of one that failed.
 */
export async function queueRemake(db: Db, attemptId: string, at: Date, tries: 1 | 2 = 2): Promise<boolean> {
  const [a] = await db.select({ ct: attempts.commandTimes, call: attempts.call, rl: attempts.repLights }).from(attempts).where(eq(attempts.id, attemptId));
  if (!a) return false;
  const w = clipWindow({ call: a.call, repLights: a.rl, commandTimes: a.ct });
  const rows = await db.insert(judgeQueue)
    .values({ attemptId, kind: 'clip', remake: true, requeued: tries === 1, nextTryAt: at, clipSeconds: clipLength(w.endMs - w.startMs) / 1000 })
    .onConflictDoUpdate({
      target: [judgeQueue.attemptId, judgeQueue.kind],
      set: { nextTryAt: at, ...(tries === 1 ? { requeued: true } : {}) },
      setWhere: sql`${judgeQueue.workerId} is null and ${judgeQueue.remake}`,
    })
    .returning({ id: judgeQueue.attemptId });
  return rows.length > 0;
}

/** A waiting remake that isn't needed any more: her card is back to the one on her clip. */
async function dropRemake(db: Db, attemptId: string) {
  const gone = await db.delete(judgeQueue)
    .where(and(eq(judgeQueue.attemptId, attemptId), eq(judgeQueue.kind, 'clip'), eq(judgeQueue.remake, true), sql`${judgeQueue.workerId} is null`))
    .returning({ id: judgeQueue.attemptId });
  return gone.length > 0;
}

/**
 * After her lights change (the judge, the bar, a referee, a spot check), and after her clip is made: a made
 * clip whose end card differs from her card now is queued again, REMAKE_AFTER_MS from now; one whose card is
 * back as it was has its waiting remake dropped. A clip still queued or being made is left: it's made with
 * her card as it is then, and compared again when it lands. Never fails the caller.
 */
export async function remakeAfterChange(db: Db, lifterId: string, now = new Date()): Promise<'queued' | 'dropped' | null> {
  if (!remakeOn()) return null;
  try {
    const c = await clipNow(db, lifterId, now);
    if (!c) return null;
    if (c.same) return (await dropRemake(db, c.attemptId)) ? 'dropped' : null;
    const due = new Date(now.getTime() + REMAKE_AFTER_MS);
    if (!await queueRemake(db, c.attemptId, due)) return null;
    await logEvent(db, 'clip_remake_queued', { lifter_id: lifterId, due: due.toISOString() }, c.attemptId);
    return 'queued';
  } catch (e) {
    console.log(JSON.stringify({ msg: 'clip remake not queued', lifter_id: lifterId, error: (e as Error).message }));
    return null;
  }
}

/**
 * "Make the board final" (item 119): every made clip in the meet whose end card still differs is queued now,
 * once (spot-check reds land here). One whose remake failed twice gets one more try. No change, no run.
 */
export async function remakeAtFinal(db: Db, meetId: string, now = new Date()): Promise<string[]> {
  if (!remakeOn()) return [];
  const rows = await db.select({ lifterId: attempts.lifterId }).from(attempts)
    .where(and(eq(attempts.meetId, meetId), eq(attempts.clipStatus, 'ready')));
  const out: string[] = [];
  for (const lifterId of [...new Set(rows.map(r => r.lifterId))]) {
    try {
      const c = await clipNow(db, lifterId, now);
      if (!c || c.same) continue;
      if (await queueRemake(db, c.attemptId, now, c.failed ? 1 : 2)) {
        out.push(c.attemptId);
        await logEvent(db, 'clip_remake_queued', { lifter_id: lifterId, at_final: true }, c.attemptId);
      }
    } catch (e) {
      console.log(JSON.stringify({ msg: 'clip remake not queued', lifter_id: lifterId, error: (e as Error).message }));
    }
  }
  return out;
}

/** /ops "Try again" on an "Old total on her clip": one more try, now. */
export async function retryRemake(db: Db, attemptId: string): Promise<boolean> {
  const [a] = await db.select({ failed: attempts.clipRemakeFailed, status: attempts.clipStatus }).from(attempts).where(eq(attempts.id, attemptId));
  if (!a?.failed || a.status !== 'ready') return false;
  const ok = await queueRemake(db, attemptId, new Date(), 1);
  if (ok) await logEvent(db, 'clip_remake_retried', {}, attemptId);
  return ok;
}

/** /ops "Clips that failed": the clips whose remake failed twice, by lifter, as "Old total on her clip". */
export async function failedRemakes(db: Db): Promise<{ attemptId: string; lifterId: string; name: string }[]> {
  const rows = await db.select({ attemptId: attempts.id, lifterId: lifters.id, name: lifters.cardName })
    .from(attempts).innerJoin(lifters, eq(lifters.id, attempts.lifterId))
    .where(and(eq(attempts.clipRemakeFailed, true), eq(attempts.clipStatus, 'ready'), sql`${lifters.deletedAt} is null`));
  return rows.map(r => ({ ...r, name: r.name ?? 'A lifter' }));
}

/**
 * "Share" or "Save to my phone" on her Clip segment: the clip she sent is this one. Her line goes, if it
 * was showing. Kept whether or not the switch is on, so the line is right from the day it is.
 */
export async function markClipSent(db: Db, lifterId: string, attemptId: string): Promise<void> {
  await db.update(attempts).set({ clipSentHash: sql`${attempts.clipCardHash}` })
    .where(and(eq(attempts.id, attemptId), eq(attempts.lifterId, lifterId), eq(attempts.clipStatus, 'ready')));
}

/** Her line (item 119): she sent a clip that ended on another total, and the new one is made. */
export const newTotalLine = (clip: { status: string | null; cardHash: string | null; sentHash: string | null } | null, on = remakeOn()) =>
  on && !!clip && clip.status === 'ready' && !!clip.sentHash && !!clip.cardHash && clip.sentHash !== clip.cardHash;
