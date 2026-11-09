// Cheers from a corner page (plan 5.4, the data's `cheers`): one of the four, from a first name or
// from no one, one per sender per attempt. June's page (/corner/demo) takes a cheer and keeps
// nothing: she's a robot, and no one reads her cheers.
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '@/db';
import { attempts, cheers, lifters } from '@/db/schema';
import { isJuneAttemptId } from '@/lib/june';
import { isDemoFlightId } from '@/lib/demo-flight';
import { publish } from '@/lib/queue';
import { CHEER_KINDS, cleanCornerName, type CheerKind, type HerCheer } from '@/lib/cheer-words';

export * from '@/lib/cheer-words';

const fromLifter = alias(lifters, 'from_lifter');
const whoKey = (s: string) => createHash('sha256').update(s).digest('base64url').slice(0, 12);

/** Her cheers on this meet's attempts, oldest first: all of them, or only those no banner has shown. */
export async function herCheers(db: Db, lifterId: string, meetId: string, onlyUnseen = false): Promise<HerCheer[]> {
  const rows = await db.select({
    id: cheers.id, kind: cheers.kind, fromLifterId: cheers.fromLifterId, corner: cheers.fromCornerName, card: fromLifter.cardName,
  }).from(cheers)
    .innerJoin(attempts, eq(attempts.id, cheers.attemptId))
    .leftJoin(fromLifter, eq(fromLifter.id, cheers.fromLifterId))
    .where(and(eq(cheers.toLifterId, lifterId), eq(attempts.meetId, meetId), onlyUnseen ? isNull(cheers.seenAt) : undefined))
    .orderBy(asc(cheers.createdAt), asc(cheers.id));
  return rows.map(r => {
    // a person is the lifter, or the corner name matched ignoring case
    const name = r.fromLifterId ? (r.card?.split(' ')[0] ?? null) : r.corner;
    const who = r.fromLifterId ? whoKey(`l:${r.fromLifterId}`) : r.corner ? whoKey(`c:${r.corner.toLocaleLowerCase()}`) : null;
    return { id: r.id, kind: r.kind, who, name };
  });
}

/** A banner showed these to her. */
export async function markSeen(db: Db, lifterId: string, ids: string[], now = new Date()) {
  const ok = ids.filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)).slice(0, 200);
  if (!ok.length) return 0;
  const r = await db.update(cheers).set({ seenAt: now })
    .where(and(eq(cheers.toLifterId, lifterId), inArray(cheers.id, ok), isNull(cheers.seenAt))).returning({ id: cheers.id });
  return r.length;
}

const SENT_STATUSES = ['uploading', 'queued', 'judging', 'close_call', 'judged'];

export type CheerResult = { status: 200; kind: CheerKind } | { status: 400 | 404 | 409; error: string };

export async function sendCheer(db: Db, token: string, body: { attempt_id?: unknown; kind?: unknown; name?: unknown }): Promise<CheerResult> {
  const kind = body.kind as CheerKind;
  if (!CHEER_KINDS.includes(kind)) return { status: 400, error: 'which cheer?' };
  const hasName = body.name != null && body.name !== '';
  const name = hasName ? cleanCornerName(body.name) : null;
  if (hasName && !name) return { status: 400, error: 'a first name is letters, spaces, \' and - only, up to 30' };
  if (token === 'demo') return isJuneAttemptId(body.attempt_id) ? { status: 200, kind } : { status: 404, error: 'no such attempt' };
  if (typeof body.attempt_id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.attempt_id)) return { status: 404, error: 'no such attempt' };
  const [l] = await db.select({ id: lifters.id, deletedAt: lifters.deletedAt }).from(lifters).where(eq(lifters.cornerToken, token));
  if (!l || l.deletedAt) return { status: 404, error: 'no such corner' };
  const [a] = await db.select({ id: attempts.id, status: attempts.status }).from(attempts)
    .where(and(eq(attempts.id, body.attempt_id), eq(attempts.lifterId, l.id)));
  if (!a || !SENT_STATUSES.includes(a.status)) return { status: 404, error: 'no such attempt' };
  const [row] = await db.insert(cheers).values({ kind, fromCornerName: name, toLifterId: l.id, attemptId: a.id })
    .onConflictDoNothing().returning({ id: cheers.id });
  if (!row) return { status: 409, error: 'already cheered' };
  await publish(db, { kind: 'cheer', lifter_id: l.id, attempt_id: a.id, cheer: kind, name });
  return { status: 200, kind };
}

/**
 * A signed-in lifter cheers a flightmate's attempt from the flight strip (5.24, look 5.8). The
 * demo flight's robots take a cheer and keep nothing. A real flightmate's attempt must be in her
 * flight and sent; the cheer is from her, once.
 */
export async function sendFlightCheer(db: Db, from: { id: string; cardName: string; flightId: string | null; isDemo: boolean }, body: { attempt_id?: unknown; kind?: unknown }): Promise<CheerResult> {
  const kind = body.kind as CheerKind;
  if (!CHEER_KINDS.includes(kind)) return { status: 400, error: 'which cheer?' };
  if (isDemoFlightId(body.attempt_id)) return from.isDemo ? { status: 200, kind } : { status: 404, error: 'no such attempt' };
  if (!from.flightId || typeof body.attempt_id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.attempt_id)) return { status: 404, error: 'no such attempt' };
  const [a] = await db.select({ id: attempts.id, status: attempts.status, lifterId: attempts.lifterId, flightId: lifters.flightId })
    .from(attempts).innerJoin(lifters, eq(lifters.id, attempts.lifterId)).where(eq(attempts.id, body.attempt_id));
  if (!a || a.flightId !== from.flightId || a.lifterId === from.id || !SENT_STATUSES.includes(a.status)) return { status: 404, error: 'no such attempt' };
  const [row] = await db.insert(cheers).values({ kind, fromLifterId: from.id, toLifterId: a.lifterId, attemptId: a.id })
    .onConflictDoNothing().returning({ id: cheers.id });
  if (!row) return { status: 409, error: 'already cheered' };
  await publish(db, { kind: 'cheer', lifter_id: a.lifterId, attempt_id: a.id, cheer: kind, name: from.cardName.split(' ')[0] });
  return { status: 200, kind };
}
