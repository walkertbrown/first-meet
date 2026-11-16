// The meet card's words and numbers (plan 5.30, look 9 "The meet card", look 5.14b for Home): one view
// that the Story and Post PNGs, the clip's end card and the print page all draw from. No DB here.
import type { Lift } from '@/db/schema';
import { LIFTS, attemptScore, type MeetAttempt, type Units } from '@/lib/meet';
import { barLoading, liftLower, platesPerSide } from '@/lib/stage/meet-words';
import { formatTotal, totalLifts, unitLine, type TotalLift } from '@/lib/total-view';

type Division = 'barbell' | 'home';

export const CARD_FOOTER = 'Hosted by Love Soo · @lovesoostrong';
/** The honest line (look 9, Walker's #soo-likeness answer): under the card, and on the certificate. */
export { HONEST_LINE } from '@/lib/site';

export type CardView = {
  name: string;
  /** "50–59 · Barbell · Asbury Park, NJ" */
  meta: string;
  /** "WINTER 2027" (the demo's "DEMO MEET") */
  season: string;
  total: string;
  totalValue: number;
  /** "LB TOTAL" / "LB LIFTED" */
  unitLine: string;
  nineForNine: boolean;
  lifts: TotalLift[];
  division: Division;
  units: Units;
  /** Barbell: the heaviest bar drawn with its plates and its line; Home: the best set's line, no drawing. */
  heaviest: { weight: number | null; plates: number[]; line: string };
};

const num = formatTotal;

/** "the plates on each side", the loading line's tail: "a blue 45 and a white 10" (3.x loading words). */
function eachSide(weight: number, units: Units): string {
  const full = barLoading(weight, units);
  const m = full.match(/ bar \+ (.*) on each side$/);
  return m ? m[1] : 'no plates';
}

/**
 * The lift on her card: the heaviest bar (Barbell) or the best set (Home), the later lift on a tie. Its
 * attempt is the one `render_clip` films (3.9 step 6, "for her best lift"), so the clip and the card agree.
 */
export function cardLiftOf(best: Record<Lift, MeetAttempt>, division: Division): MeetAttempt {
  const list = LIFTS.map(l => best[l]);
  return division === 'home'
    ? list.reduce((b, a) => (attemptScore(a, 'home') >= attemptScore(b, 'home') ? a : b))
    : list.reduce((b, a) => (a.weight >= b.weight ? a : b));
}

/**
 * Barbell: "Heaviest bar · 155 lb deadlift · a blue 45 and a white 10 each side" (look 9). The heaviest of
 * her three counted lifts; a tie goes to the later lift (the deadlift is the meet's last word).
 * Home (look 5.14b): "Best set · 25 lb bell × 10", the set that scored most; a pair is "dumbbells".
 */
export function heaviestOf(best: Record<Lift, MeetAttempt>, division: Division, units: Units): CardView['heaviest'] {
  if (division === 'home') {
    const top = cardLiftOf(best, 'home');
    const pair = !!top.homeLoad && top.homeLoad !== top.weight;
    return { weight: null, plates: [], line: `Best set · ${num(top.weight)} ${units} ${pair ? 'dumbbells' : 'bell'} × ${top.repsDeclared ?? 0}` };
  }
  const top = cardLiftOf(best, 'barbell');
  return {
    weight: top.weight,
    plates: platesPerSide(top.weight, units),
    line: `Heaviest bar · ${num(top.weight)} ${units} ${liftLower(top.lift, 'barbell')} · ${eachSide(top.weight, units)} each side`,
  };
}

export function metaLine(l: { ageGroup: string | null; division: Division; hometown: string }): string {
  return [l.ageGroup, l.division === 'home' ? 'Home' : 'Barbell', l.hometown.trim() || null].filter(Boolean).join(' · ');
}

export function cardView(
  l: { cardName: string; ageGroup: string | null; division: Division; hometown: string; units: Units },
  meetName: string | null,
  t: { value: number; best: Record<Lift, MeetAttempt>; nineForNine: boolean },
): CardView {
  return {
    name: l.cardName,
    meta: metaLine(l),
    season: (meetName ?? 'Winter 2027').toUpperCase(),
    total: num(t.value),
    totalValue: t.value,
    unitLine: unitLine(l.units, l.division),
    nineForNine: t.nineForNine,
    lifts: totalLifts(t.best, l.division),
    division: l.division,
    units: l.units,
    heaviest: heaviestOf(t.best, l.division, l.units),
  };
}

/** og:title (5.5): "<card_name> totaled <total> <unit> at First Meet". */
export const ogTitle = (v: Pick<CardView, 'name' | 'total' | 'units'>) => `${v.name} totaled ${v.total} ${v.units} at First Meet`;
/** 5.5's Body. */
export const publicBody = (name: string) => `${name} did her first powerlifting meet at First Meet, hosted by Love Soo.`;

/** "Diane R." → "diane-r", for a saved file's name ("Save to my phone"). */
export const fileStem = (name: string) =>
  name.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-').slice(0, 40) || 'my';
