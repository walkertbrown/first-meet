// The board (plan 5.6, 5.29, 5.31; look 5.11) and the awards (5.31), from each lifter's nine.
// Kept free of server code, so the sample meet (5.3) and the live page draw the same rows.
import type { Lift } from '@/db/schema';
import { LIFTS, ORDER, attemptScore, meetTotal, placeOrder, toKg, type MeetAttempt, type Units } from '@/lib/meet';
import { homeScoreText } from '@/lib/total-view';

export type Division = 'barbell' | 'home';
export const AGE_GROUPS = ['Open', '40–49', '50–59', '60–69', '70+'] as const;

/** One lifter as the board sees her. `age` is her age on meet day, when known (5.31's oldest lifter). */
export type BoardLifter = {
  id: string; name: string; ageGroup: string | null; age: number | null; division: Division; units: Units;
  hometown?: string; attempts: MeetAttempt[];
};

export type LampCall = 'white' | 'red' | 'pulse' | 'off';
export type BoardCell = { text: string; lamps: LampCall[] };
export type BoardRow = {
  id: string; name: string; ageGroup: string; division: Division; units: Units;
  total: number; totalText: string; lastCountedAt: Date | null; nineForNine: boolean;
  lifts: Record<Lift, BoardCell>;
};

const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

const lampOf = (a: MeetAttempt | undefined): LampCall =>
  !a ? 'off' : a.call === 'white' ? 'white' : a.call === 'red' ? 'red' : a.call === 'close' || a.status === 'close_call' ? 'pulse' : 'off';

/** A lift's cell: her best good one ("130", Home "25 × 8"), or "—" with none; and its three lamps. */
function cell(list: MeetAttempt[], lift: Lift, division: Division): BoardCell {
  const mine = ORDER.filter(s => s.lift === lift).map(s => list.find(a => a.lift === s.lift && a.number === s.number));
  const good = mine.filter((a): a is MeetAttempt => a?.call === 'white');
  const best = good.reduce<MeetAttempt | null>((b, a) => (!b || attemptScore(a, division) > attemptScore(b, division) ? a : b), null);
  return { text: best ? (division === 'home' ? homeScoreText(best) : num(best.weight)) : '—', lamps: mine.map(lampOf) };
}

/** Everyone in one division who totaled, best first (3.8's ties). The board has no place for a lifter with no total. */
export function boardRows(list: BoardLifter[], division: Division, closed = true): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const l of list) {
    if (l.division !== division) continue;
    const t = meetTotal(l.attempts, division, closed);
    if (t.kind !== 'total') continue;
    rows.push({
      id: l.id, name: l.name, ageGroup: l.ageGroup ?? 'Open', division, units: l.units,
      total: t.value, totalText: num(t.value), lastCountedAt: t.lastCountedAt, nineForNine: t.nineForNine,
      lifts: Object.fromEntries(LIFTS.map(lift => [lift, cell(l.attempts, lift, division)])) as Record<Lift, BoardCell>,
    });
  }
  return placeOrder(rows);
}

/** The rows a filter shows, each with its place among them (an age group places within itself). The search keeps places. */
export function shownRows(rows: BoardRow[], ageGroup: string | null, search = ''): (BoardRow & { place: number })[] {
  const q = search.trim().toLowerCase();
  return rows.filter(r => !ageGroup || r.ageGroup === ageGroup)
    .map((r, i) => ({ ...r, place: i + 1 }))
    .filter(r => !q || r.name.toLowerCase().includes(q));
}

/** Her place in her division and age group (5.29's card, 5.31's row card), or null with no total. */
export function placeOf(rows: BoardRow[], id: string): { place: number; of: number; ageGroup: string; division: Division } | null {
  const me = rows.find(r => r.id === id);
  if (!me) return null;
  const group = rows.filter(r => r.ageGroup === me.ageGroup);
  return { place: group.indexOf(me) + 1, of: group.length, ageGroup: me.ageGroup, division: me.division };
}

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// ---------- awards (5.31) ----------

export type AwardKind = 'nine_for_nine' | 'top_total' | 'first_over_60' | 'oldest' | 'comeback';
export type Award = { kind: AwardKind; title: string; lifterId: string; name: string; ageGroup: string; division: Division; reason: string };

const divisionWord = (d: Division) => (d === 'home' ? 'Home' : 'Barbell');
const liftWord = (lift: Lift, d: Division) => ({ squat: d === 'home' ? 'Goblet squat' : 'Squat', bench: d === 'home' ? 'Press' : 'Bench', deadlift: 'Deadlift' })[lift];
const scoreText = (a: MeetAttempt, d: Division, units: Units) => (d === 'home' ? homeScoreText(a) : `${num(a.weight)} ${units}`);

/** A difference of kg worked out from lb, with its float noise taken off (a tie stays a tie). */
const near = (d: number) => (Math.abs(d) < 1e-6 ? 0 : d);

/** Her best comeback: a red on attempt 1, then a white on 3 at a heavier weight; the biggest jump (kg, or Home's score). */
function comebackOf(l: BoardLifter): { lift: Lift; jump: number; thirdScore: number; first: MeetAttempt; third: MeetAttempt } | null {
  let best: ReturnType<typeof comebackOf> = null;
  for (const lift of LIFTS) {
    const first = l.attempts.find(a => a.lift === lift && a.number === 1);
    const third = l.attempts.find(a => a.lift === lift && a.number === 3);
    if (first?.call !== 'red' || third?.call !== 'white') continue;
    const score = (a: MeetAttempt) => (l.division === 'home' ? (a.homeLoad ?? a.weight) * (a.repsDeclared ?? 0) : toKg(a.weight, l.units));
    const jump = score(third) - score(first);
    if (jump > 1e-6 && (!best || jump > best.jump)) best = { lift, jump, thirdScore: score(third), first, third };
  }
  return best;
}

/**
 * The awards (5.31), each division on its own, as the boards are:
 * - "9 for 9": every lifter with nine good lifts
 * - "Top total": the top total in each division and age group
 * - "First total over 60": every 60+ lifter who totaled
 * - "Oldest lifter to total": in each division (everyone at that age, on a tie)
 * - "Biggest comeback": red on attempt 1, white on 3 at a heavier weight, any lift; the biggest jump wins, per division
 */
export function awards(list: BoardLifter[], closed = true): Award[] {
  const out: Award[] = [];
  for (const division of ['barbell', 'home'] as const) {
    const rows = boardRows(list, division, closed);
    if (!rows.length) continue;
    const by = new Map(list.map(l => [l.id, l]));
    const award = (kind: AwardKind, title: string, r: BoardRow, reason: string) =>
      out.push({ kind, title, lifterId: r.id, name: r.name, ageGroup: r.ageGroup, division, reason });
    const totalLine = (r: BoardRow) => `${r.totalText} ${r.units} ${division === 'home' ? 'lifted' : 'total'}`;
    for (const r of rows) if (r.nineForNine) award('nine_for_nine', '9 for 9', r, `Nine good lifts out of nine · ${divisionWord(division)}`);
    for (const g of AGE_GROUPS) {
      const top = rows.find(r => r.ageGroup === g);
      if (top) award('top_total', 'Top total', top, `${divisionWord(division)} · ${g} · ${totalLine(top)}`);
    }
    for (const r of rows) if (r.ageGroup === '60–69' || r.ageGroup === '70+') award('first_over_60', 'First total over 60', r, `${totalLine(r)} · ${divisionWord(division)}`);
    const aged = rows.filter(r => by.get(r.id)?.age != null);
    const oldest = Math.max(...aged.map(r => by.get(r.id)!.age!));
    for (const r of aged) if (by.get(r.id)!.age === oldest) award('oldest', 'Oldest lifter to total', r, `Age ${oldest} · ${divisionWord(division)} · ${totalLine(r)}`);
    // one winner: the biggest jump; on a tie, the heavier attempt 3, then (as 3.8's ties) the one made first
    const won = rows.map(r => ({ r, l: by.get(r.id)!, c: comebackOf(by.get(r.id)!) }))
      .filter((x): x is { r: BoardRow; l: BoardLifter; c: NonNullable<ReturnType<typeof comebackOf>> } => !!x.c)
      .sort((a, b) => near(b.c.jump - a.c.jump) || near(b.c.thirdScore - a.c.thirdScore)
        || ((a.c.third.recordedAt?.getTime() ?? Infinity) - (b.c.third.recordedAt?.getTime() ?? Infinity)))[0];
    if (won) award('comeback', 'Biggest comeback', won.r, `${liftWord(won.c.lift, division)}: no lift at ${scoreText(won.c.first, division, won.l.units)} on attempt 1, then a good lift at ${scoreText(won.c.third, division, won.l.units)} on attempt 3`);
  }
  return out;
}
