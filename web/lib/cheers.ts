// Cheers from a corner page (plan 5.4, the data's `cheers`): one of the four, from a first name or
// from no one, one per sender per attempt. June's page (/corner/demo) takes a cheer and keeps
// nothing: she's a robot, and no one reads her cheers.
import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, cheers, lifters } from '@/db/schema';
import { isJuneAttemptId } from '@/lib/june';
import { publish } from '@/lib/queue';

export const CHEERS = {
  white_lights: 'White lights!',
  strong: 'Strong!',
  got_this: 'You\'ve got this',
  see_you: 'See you on the platform',
} as const;
export type CheerKind = keyof typeof CHEERS;
export const CHEER_KINDS = Object.keys(CHEERS) as CheerKind[];

/** A corner's first name: 1–30 characters, letters, spaces and ' or - only. Else null. */
export function cleanCornerName(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return /^[\p{L}' -]{1,30}$/u.test(t) && /\p{L}/u.test(t) ? t : null;
}

/**
 * The cheer sheet's Eyebrow (5.4, item 79): "Cheer <name> · <Lift> <n>" for an attempt, or
 * "Cheer <first name> · today's session" for a training session. The type sets the capitals.
 */
export const cheerEyebrow = (name: string, what: string | 'session') =>
  `Cheer ${name} · ${what === 'session' ? 'today\'s session' : what}`;

/** What she reads when a cheer lands (5.4): "<name> cheered: <cheer>", or "Someone in your corner …". */
export const cheerLine = (kind: CheerKind, name: string | null) =>
  `${name ?? 'Someone in your corner'} cheered: ${CHEERS[kind]}`;

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
  if (!a || !['uploading', 'queued', 'judging', 'close_call', 'judged'].includes(a.status)) return { status: 404, error: 'no such attempt' };
  const [row] = await db.insert(cheers).values({ kind, fromCornerName: name, toLifterId: l.id, attemptId: a.id })
    .onConflictDoNothing().returning({ id: cheers.id });
  if (!row) return { status: 409, error: 'already cheered' };
  await publish(db, { kind: 'cheer', lifter_id: l.id, attempt_id: a.id, cheer: kind, name });
  return { status: 200, kind };
}
