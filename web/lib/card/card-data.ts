// Her meet card from the database (plan 5.30, 5.5): the card token, made on first need, and the card's
// view for a token or a lifter. A card exists only once she has a total (5.28's "You totaled").
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, lifters, meets } from '@/db/schema';
import { meetAttempts, totalFor } from '@/lib/meet-flow';
import { newCornerToken } from '@/lib/demo';
import { CARD_WORDS } from '@/lib/card/card-words';
import { attemptSheet, type Certificate } from '@/lib/card/certificate';
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

/** Her card clip: `render_clip`'s MP4 of the lift on her card (5.30). */
export type CardClip = { attemptId: string; status: 'queued' | 'rendering' | 'ready' | 'failed' | null; key: string | null; sharedAt: Date | null };
export type Card = { lifter: LifterRow; view: CardView; clip: CardClip | null };

/**
 * Whether her card link plays the clip (5.5, item 99): it's made, and she shared it from 5.30's Clip
 * segment or her videos are "Anyone with my card or corner link". "My flight" alone isn't public.
 */
export const clipOnCardLink = (visibility: LifterRow['clipVisibility'], clip: CardClip | null) =>
  !!clip?.key && clip.status === 'ready' && (!!clip.sharedAt || visibility === 'link');

/** 5.30's line under the Clip, or null when her videos are already on her card link. */
export function clipVisibilityLine(visibility: LifterRow['clipVisibility'], clip: CardClip | null): string | null {
  if (visibility !== 'judges') return null;
  return clip?.sharedAt ? CARD_WORDS.shared : CARD_WORDS.onlyYou;
}

export const CLIP_MAKING = CARD_WORDS.making;

/** "Share" or "Copy my card link" on the Clip segment, the first time (item 99). "Save to my phone" doesn't. */
export async function shareCardClip(db: Db, lifterId: string, attemptId: string): Promise<boolean> {
  const [u] = await db.update(attempts).set({ clipSharedAt: sql`now()` })
    .where(and(eq(attempts.id, attemptId), eq(attempts.lifterId, lifterId), isNull(attempts.clipSharedAt), eq(attempts.clipStatus, 'ready')))
    .returning({ id: attempts.id });
  return !!u;
}

/** Her card, or null while she has no total (still lifting, waiting on a light, or bombed out). */
export async function cardFor(db: Db, l: LifterRow, now = new Date()): Promise<Card | null> {
  if (!l.meetId) return null;
  const t = await totalFor(db, l, undefined, now);
  if (t.kind !== 'total') return null;
  const [m] = await db.select({ name: meets.name }).from(meets).where(eq(meets.id, l.meetId));
  const top = t.top;
  let clip: CardClip | null = null;
  if (top.id) {
    const [a] = await db.select({ status: attempts.clipStatus, key: attempts.clipKey, sharedAt: attempts.clipSharedAt }).from(attempts).where(eq(attempts.id, top.id));
    clip = { attemptId: top.id, status: a?.status ?? null, key: a?.key ?? null, sharedAt: a?.sharedAt ?? null };
  }
  return { lifter: l, view: cardView({ ...l, units: l.units as Units }, m?.name ?? null, t), clip };
}

export async function cardForToken(db: Db, token: string, now = new Date()): Promise<Card | null> {
  if (!CARD_TOKEN.test(token)) return null;
  // a deleted account's card goes with it (5.34)
  const [l] = await db.select().from(lifters).where(and(eq(lifters.cardToken, token), isNull(lifters.deletedAt)));
  return l ? cardFor(db, l, now) : null;
}

/** The certificate (5.30 Print): her card's words and all nine attempts, for /me/card/print. */
export async function certificateFor(db: Db, card: Card): Promise<Certificate> {
  const list = await meetAttempts(db, card.lifter);
  const { name, meta, season, total, unitLine, nineForNine, lifts } = card.view;
  return { name, meta, season, total, unitLine, nineForNine, lifts, sheet: attemptSheet(list, card.lifter.division, card.lifter.units) };
}
