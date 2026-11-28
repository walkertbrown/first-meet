// A bomb-out's best lift (plan 5.28, 3.9 step 6, item 101; look 9 "The bomb-out clip"): the words on the clip's
// end frame and the page's thumbnail, and the end frame's signed path for render_clip. No database here.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Units } from '@/lib/meet';
import { formatTotal } from '@/lib/total-view';
import { liftLower } from '@/lib/stage/meet-words';
import { liftName } from '@/lib/referee-view';
import { metaLine } from '@/lib/card/card-view';

type Division = 'barbell' | 'home';

export type BestLiftView = {
  name: string;
  /** "50–59 · Barbell · Asbury Park, NJ", as on the card */
  meta: string;
  /** "WINTER 2027" (the demo's "DEMO MEET") */
  season: string;
  /** "DEADLIFT · 2 OF 3", the HUD's words */
  liftLine: string;
  /** the number only, like the total: "155" */
  weight: string;
  /** "LB" or "KG"; Home "LB × 8 REPS" */
  unitLine: string;
  /** the thumbnail's words for a screen reader */
  label: string;
};

export function bestLiftView(
  l: { cardName: string; ageGroup: string | null; division: Division; hometown: string; units: Units },
  meetName: string | null,
  a: { lift: string; number: number; weight: number; repsDeclared: number | null },
): BestLiftView {
  const units = l.units.toUpperCase();
  const home = l.division === 'home';
  const weight = formatTotal(a.weight);
  const reps = a.repsDeclared ?? 0;
  return {
    name: l.cardName,
    meta: metaLine(l),
    season: (meetName ?? 'Winter 2027').toUpperCase(),
    liftLine: `${liftName(a.lift, l.division).toUpperCase()} · ${a.number} OF 3`,
    weight,
    unitLine: home ? `${units} × ${reps} REPS` : units,
    label: `${l.cardName}'s best lift: ${liftLower(a.lift, l.division)}, attempt ${a.number}, ${weight} ${l.units}${home ? ` × ${reps} reps` : ''}, three white lights.`,
  };
}

/** The end frame's link lasts as long as the clip run's lease, with a minute's room. */
export const END_FRAME_S = 360;

const sign = (what: string, id: string, t: number, secret: string) => createHmac('sha256', secret).update(`${what}.${t}.${id}`).digest('hex');

/** render_clip's `card_path` for a bomb-out: her best lift's end frame, signed, since it has no card link. */
export function endFramePath(attemptId: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  return `/api/internal/end-frame/${attemptId}.png?t=${now}&s=${sign('end-frame', attemptId, now, secret)}`;
}

function signedOk(what: string, id: string, t: string | null, s: string | null, secret: string | undefined, now: number): boolean {
  if (!secret || !t || !s || !/^\d{9,11}$/.test(t) || !/^[0-9a-f]{64}$/.test(s)) return false;
  const at = Number(t);
  if (at > now + 60 || now - at > END_FRAME_S) return false;
  return timingSafeEqual(Buffer.from(sign(what, id, at, secret), 'hex'), Buffer.from(s, 'hex'));
}

export function endFrameOk(attemptId: string, t: string | null, s: string | null, secret: string | undefined, now = Math.floor(Date.now() / 1000)): boolean {
  return signedOk('end-frame', attemptId, t, s, secret, now);
}

/**
 * render_clip's `card_path` for a total: her Story at her card link, marked as a claimed clip's end card so
 * it's drawn first and the run is told to ask again rather than wait out its fetch (NerdCider, 64d5e85).
 * Signed, so a person's ask can't jump the line.
 */
export function clipCardPath(token: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  return `/api/card/${token}.png?f=story&clip=1&t=${now}&s=${sign('clip-card', token, now, secret)}`;
}

export function clipCardOk(token: string, t: string | null, s: string | null, secret: string | undefined, now = Math.floor(Date.now() / 1000)): boolean {
  return signedOk('clip-card', token, t, s, secret, now);
}

// the block's words live where the browser can have them (no node:crypto)
export { playLength, BEST_LIFT_WORDS } from '@/lib/card/best-lift-words';
