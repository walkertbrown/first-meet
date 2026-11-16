// Her meet card from the database (plan 5.30, 5.5): the card token, made on first need, and the card's
// view for a token or a lifter. A card exists only once she has a total (5.28's "You totaled").
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { lifters, meets } from '@/db/schema';
import { totalFor } from '@/lib/meet-flow';
import { newCornerToken } from '@/lib/demo';
import { cardView, type CardView } from '@/lib/card/card-view';
import type { Units } from '@/lib/meet';

type LifterRow = typeof lifters.$inferSelect;

/** A card token is 16 base64url characters (12 random bytes), like the corner's. */
export const CARD_TOKEN = /^[A-Za-z0-9_-]{16}$/;

/** Her card token, made the first time her card is opened. A race keeps whichever was written first. */
export async function ensureCardToken(db: Db, l: Pick<LifterRow, 'id' | 'cardToken'>): Promise<string> {
  if (l.cardToken) return l.cardToken;
  const t = newCornerToken();
  const [u] = await db.update(lifters).set({ cardToken: t }).where(and(eq(lifters.id, l.id), isNull(lifters.cardToken))).returning({ t: lifters.cardToken });
  if (u?.t) return u.t;
  const [r] = await db.select({ t: lifters.cardToken }).from(lifters).where(eq(lifters.id, l.id));
  return r!.t!;
}

export type Card = { lifter: LifterRow; view: CardView };

/** Her card, or null while she has no total (still lifting, waiting on a light, or bombed out). */
export async function cardFor(db: Db, l: LifterRow, now = new Date()): Promise<Card | null> {
  if (!l.meetId) return null;
  const t = await totalFor(db, l, undefined, now);
  if (t.kind !== 'total') return null;
  const [m] = await db.select({ name: meets.name }).from(meets).where(eq(meets.id, l.meetId));
  return { lifter: l, view: cardView({ ...l, units: l.units as Units }, m?.name ?? null, t) };
}

export async function cardForToken(db: Db, token: string, now = new Date()): Promise<Card | null> {
  if (!CARD_TOKEN.test(token)) return null;
  // a deleted account's card goes with it (5.34)
  const [l] = await db.select().from(lifters).where(and(eq(lifters.cardToken, token), isNull(lifters.deletedAt)));
  return l ? cardFor(db, l, now) : null;
}
