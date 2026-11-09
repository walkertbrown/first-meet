// The meet window's two refusals (plan 3.8, items 85 and 86): a lift started at or after the close,
// and a clip still not uploaded at the clip deadline (closes_at + 6 h). Either way the attempt is
// `void` with its `void_reason`: never a red, never lifted again, simply not judged. The demo meet
// (and the sample replay) never closes.
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, meets, type VoidReason } from '@/db/schema';
import { logEvent, publish } from '@/lib/queue';
import { windowTime } from '@/lib/stage/meet-words';

export const CLIP_GRACE_MS = 6 * 3_600_000;

type MeetTimes = Pick<typeof meets.$inferSelect, 'kind' | 'closesAt' | 'clipDeadlineAt'>;

/** Only a real (or staging's test) meet has a window that closes. */
const closes = (m: Pick<MeetTimes, 'kind'>) => m.kind === 'real' || m.kind === 'test';

/** The clip deadline: the meet's own `clip_deadline_at`, or `closes_at` + 6 h. Null when it never closes. */
export function clipDeadline(m: MeetTimes): Date | null {
  if (!closes(m) || !m.closesAt) return null;
  return m.clipDeadlineAt ?? new Date(m.closesAt.getTime() + CLIP_GRACE_MS);
}

/** From `closes_at` on, the platform is closed. */
export const meetClosed = (m: MeetTimes, now = new Date()) => closes(m) && !!m.closesAt && now >= m.closesAt;

/** A clip that finishes now is too late. */
export const pastDeadline = (m: MeetTimes, now = new Date()) => {
  const d = clipDeadline(m);
  return !!d && now > d;
};

/**
 * Whether this upload is refused (3.8): a `recorded_at` at or after `closes_at` is `after_close`;
 * any upload step after the clip deadline is `upload_late`. Null: carry on.
 */
export function windowRefusal(m: MeetTimes, recordedAt: Date | null, now = new Date()): Exclude<VoidReason, 'turned' | 'lost_bar'> | null {
  if (!closes(m) || !m.closesAt) return null;
  if (recordedAt && recordedAt >= m.closesAt) return 'after_close';
  if (pastDeadline(m, now)) return 'upload_late';
  return null;
}

/** What the phone needs to word a refusal (3.11): the reason and the two times. */
export const refusalBody = (m: MeetTimes, reason: VoidReason) => ({
  error: reason === 'after_close' ? 'the platform had closed' : 'the clip arrived too late',
  void_reason: reason,
  closes_at: m.closesAt?.toISOString() ?? null,
  clip_deadline_at: clipDeadline(m)?.toISOString() ?? null,
});

const OPEN_STATUSES = ['declared', 'recording', 'uploading'] as const;

/** Marks one attempt `void` with its reason, if it hasn't left the phone. True if it changed. */
export async function voidAttempt(db: Db, attemptId: string, reason: VoidReason): Promise<boolean> {
  const [a] = await db.update(attempts).set({ status: 'void', voidReason: reason })
    .where(and(eq(attempts.id, attemptId), inArray(attempts.status, [...OPEN_STATUSES]))).returning();
  if (!a) return false;
  await logEvent(db, 'attempt_void', { reason }, a.id);
  await publish(db, { kind: 'attempt', attempt_id: a.id, lifter_id: a.lifterId, status: 'void' });
  return true;
}

/**
 * The clip deadline's job (3.8): every attempt of a meet past its deadline whose upload started but
 * never finished is `void` (`upload_late`), so every total settles. An attempt only declared isn't
 * touched: the server can't tell a lift she never took from one still on an offline phone, and a
 * slot she didn't lift doesn't count once the platform has closed anyway. If that phone sends it
 * later, the upload is refused as too late then. Runs on read (her platform and total) and from
 * the test meet's "Run the clip deadline now". Returns how many it voided.
 */
export async function runClipDeadline(db: Db, now = new Date(), meetId?: string): Promise<number> {
  const due = await db.select().from(meets).where(and(
    inArray(meets.kind, ['real', 'test']), isNotNull(meets.closesAt), ne(meets.status, 'final'),
    meetId ? eq(meets.id, meetId) : undefined,
  ));
  let n = 0;
  for (const m of due) {
    if (!pastDeadline(m, now)) continue;
    const late = await db.select({ id: attempts.id }).from(attempts)
      .where(and(eq(attempts.meetId, m.id), inArray(attempts.status, ['recording', 'uploading'])));
    for (const a of late) if (await voidAttempt(db, a.id, 'upload_late')) n++;
  }
  return n;
}

// the not-judged words live with the phone's words, so a client screen can use them
export { notJudgedLine, notJudgedLabel } from '@/lib/stage/meet-words';

/**
 * "I'm ready" after the close (3.8, 3.11, item 85): the phone has stopped the lift by its corrected
 * clock and asks the server, which decides by its own. Closed: the attempt is `void`
 * (`after_close`), 200 with the sheet's times. Still open (her phone's clock ran ahead): 409, and
 * the lift goes ahead.
 */
export async function startAfterClose(db: Db, attemptId: string, lifterId: string, now = new Date()):
  Promise<{ status: 200 | 403 | 404 | 409; body: Record<string, unknown> }> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return { status: 404, body: { error: 'no such attempt' } };
  const [a] = await db.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!a) return { status: 404, body: { error: 'no such attempt' } };
  if (a.lifterId !== lifterId) return { status: 403, body: { error: 'not your attempt' } };
  const [m] = await db.select().from(meets).where(eq(meets.id, a.meetId));
  if (!m || !meetClosed(m, now)) return { status: 409, body: { error: 'the platform is open' } };
  if (a.status === 'declared') await voidAttempt(db, a.id, 'after_close');
  return { status: 200, body: refusalBody(m, 'after_close') };
}

/**
 * Whether "Make the board final" can be pressed yet (5.35, 3.8, item 85): never before the clip
 * deadline, so results and awards never miss a late clip, and never while a close call waits.
 * (5.35's spot checks join this with the host desk, phase 5.) `line` is its Small line while it
 * waits on the deadline: "Clips can still arrive until Sunday 5 am Eastern."
 */
export async function boardFinalReady(db: Db, m: MeetTimes & { id: string }, now = new Date()):
  Promise<{ ok: true } | { ok: false; why: 'clip_deadline' | 'close_calls'; line: string | null }> {
  const d = clipDeadline(m);
  if (d && now <= d) return { ok: false, why: 'clip_deadline', line: `Clips can still arrive until ${windowTime(d.toISOString(), { weekday: true, local: null })}.` };
  const [waiting] = await db.select({ id: attempts.id }).from(attempts)
    .where(and(eq(attempts.meetId, m.id), eq(attempts.status, 'close_call'))).limit(1);
  if (waiting) return { ok: false, why: 'close_calls', line: null };
  return { ok: true };
}
