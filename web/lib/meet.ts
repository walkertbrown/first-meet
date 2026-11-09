// The meet's attempt rules (plan 3.3, 3.8 Barbell, 3.8a Home): caps, openers, the declare
// choices, the order of the nine attempts, the total or bomb-out, and ties. Pure functions, so
// the phone, the server and web/lib/meet.test.ts all use the same rules.
import type { Division, HomeWeight, Lift, RepLight } from '@/db/schema';

export type Units = 'lb' | 'kg';
export const LIFTS: Lift[] = ['squat', 'bench', 'deadlift'];

/** 3.3: lb squat/deadlift 10, bench 5; kg 5 and 2.5. The bigger step is twice the small. */
export const smallStep = (lift: Lift, units: Units) => (units === 'lb' ? (lift === 'bench' ? 5 : 10) : lift === 'bench' ? 2.5 : 5);
export const bigStep = (lift: Lift, units: Units) => 2 * smallStep(lift, units);
export const barWeight = (units: Units) => (units === 'lb' ? 45 : 20);
/** The cap on a Home attempt's reps (3.8a, and 3.10's 90 s). */
export const HOME_MAX_REPS = 20;

const round = (n: number) => Math.round(n * 1000) / 1000;
const floorTo = (n: number, step: number) => round(Math.floor(n / step + 1e-9) * step);

// ---------- caps ----------

/** A judged training set (3.2 `judged_sets`), with the week of the block it was in. */
export type JudgedSet = { movement: string; weight: number; reps: number; allWhite: boolean; lights: RepLight[]; week: number; at: Date; lastSetOfWeek?: boolean };
/** A logged training set (3.2 `sets`). */
export type LoggedSet = { movement: string; weight: number; reps: number; week: number; at: Date };

export type BarbellCap = { weight: number; judged: boolean; at: Date | null };

/**
 * 3.8: the heaviest weight in any all-white judged set of 3 or more reps from weeks 2–11; else
 * her best logged set of 3 or more ("Not judged yet"); else the bar (a late joiner).
 */
export function barbellCap(lift: Lift, judged: JudgedSet[], logged: LoggedSet[], units: Units, bar = barWeight(units)): BarbellCap {
  const best = <T extends { weight: number; at: Date }>(xs: T[]) =>
    xs.reduce<T | null>((b, x) => (!b || x.weight > b.weight || (x.weight === b.weight && x.at < b.at) ? x : b), null);
  const j = best(judged.filter(s => s.movement === lift && s.allWhite && s.reps >= 3 && s.week >= 2 && s.week <= 11));
  if (j) return { weight: j.weight, judged: true, at: j.at };
  const l = best(logged.filter(s => s.movement === lift && s.reps >= 3));
  if (l) return { weight: l.weight, judged: false, at: l.at };
  return { weight: bar, judged: false, at: null };
}

/**
 * 3.8a, a judged set's counted reps: all of an all-white set; in the last set of weeks 8–11,
 * the white reps before the first red or close one; otherwise none.
 */
export function countedReps(s: JudgedSet): number {
  if (s.allWhite) return s.reps;
  if (s.lastSetOfWeek && s.week >= 8 && s.week <= 11) {
    const k = s.lights.findIndex(l => l.call !== 'white');
    return k < 0 ? s.lights.length : k;
  }
  return 0;
}

export type HomeCap = { reps: number; weight: number; judged: boolean; at: Date | null };

/** 3.8a: the most counted reps in a judged set at her meet weight (else the most logged), never over 20. */
export function homeCap(lift: Lift, weight: number, judged: JudgedSet[], logged: LoggedSet[]): HomeCap {
  let best: { reps: number; at: Date } | null = null;
  for (const s of judged) {
    if (s.movement !== lift || s.weight !== weight) continue;
    const n = countedReps(s);
    if (n > 0 && (!best || n > best.reps || (n === best.reps && s.at < best.at))) best = { reps: n, at: s.at };
  }
  if (best) return { reps: Math.min(HOME_MAX_REPS, best.reps), weight, judged: true, at: best.at };
  const l = logged.filter(s => s.movement === lift && s.weight === weight).reduce((m, s) => Math.max(m, s.reps), 0);
  return { reps: Math.min(HOME_MAX_REPS, Math.max(1, l)), weight, judged: false, at: null };
}

/**
 * 3.3: the load a Home weight counts as. The goblet squat is one weight; the overhead press is a
 * pair (both together); the deadlift is a pair or one bell.
 */
export function homeLoad(lift: Lift, w: number, kind: HomeWeight['kind'] | undefined): number {
  if (lift === 'squat') return w;
  if (lift === 'bench') return 2 * w;
  return kind === 'pair' ? 2 * w : w;
}
/** The kind of a Home weight she owns (the overhead press is always a pair). */
export const homeKind = (lift: Lift, w: number, owned: HomeWeight[]): HomeWeight['kind'] =>
  lift === 'squat' ? 'bell' : lift === 'bench' ? 'pair' : (owned.find(o => o.weight === w)?.kind ?? 'pair');

export type HomeWeightChoice = { weight: number; kind: HomeWeight['kind']; capReps: number; score: number; judged: boolean };

/**
 * 3.8a and look 5.9: her meet-weight choices for a lift, the weights she has a judged set at
 * with at least 1 white rep, each scored load × her cap there. The highest score is the
 * default; ties go to the heavier weight. With no judged set, her best logged set's weight.
 */
export function homeWeightChoices(lift: Lift, judged: JudgedSet[], logged: LoggedSet[], owned: HomeWeight[]): { choices: HomeWeightChoice[]; best: HomeWeightChoice | null } {
  const ws = [...new Set(judged.filter(s => s.movement === lift && s.lights.some(l => l.call === 'white')).map(s => s.weight))];
  let choices = ws.map(w => {
    const kind = homeKind(lift, w, owned);
    const cap = homeCap(lift, w, judged, logged);
    return { weight: w, kind, capReps: cap.reps, score: homeLoad(lift, w, kind) * cap.reps, judged: cap.judged };
  });
  if (!choices.length) {
    const l = logged.filter(s => s.movement === lift).sort((a, b) => b.weight * b.reps - a.weight * a.reps)[0];
    if (l) {
      const kind = homeKind(lift, l.weight, owned);
      const cap = homeCap(lift, l.weight, [], logged);
      choices = [{ weight: l.weight, kind, capReps: cap.reps, score: homeLoad(lift, l.weight, kind) * cap.reps, judged: false }];
    }
  }
  choices.sort((a, b) => a.weight - b.weight);
  const best = choices.reduce<HomeWeightChoice | null>((b, c) => (!b || c.score > b.score || (c.score === b.score && c.weight > b.weight) ? c : b), null);
  return { choices, best };
}

// ---------- openers ----------

/**
 * 3.8: 90% of her cap, rounded down to the lift's small step. If that is the cap itself, the cap
 * minus a small step. Never below the bar.
 */
export function barbellOpener(cap: number, lift: Lift, units: Units, bar = barWeight(units)): number {
  const s = smallStep(lift, units);
  let o = floorTo(0.9 * cap, s);
  if (o >= cap) o = round(cap - s);
  return Math.max(bar, Math.min(o, cap));
}

/** 5.23: the suggested opener, then one and two small steps lighter (none below the bar). */
export function barbellOpenerChoices(cap: number, lift: Lift, units: Units, bar = barWeight(units)): number[] {
  const o = barbellOpener(cap, lift, units, bar);
  const s = smallStep(lift, units);
  return [o, round(o - s), round(o - 2 * s)].filter((w, i, a) => w >= bar && a.indexOf(w) === i);
}

/** 3.8a: 90% of her cap in reps, rounded down, and at least 1 under the cap when it's 2 or more. */
export function homeOpener(capReps: number): number {
  const cap = Math.max(1, Math.min(HOME_MAX_REPS, capReps));
  if (cap < 2) return cap;
  return Math.max(1, Math.min(cap - 1, Math.floor(0.9 * cap + 1e-9)));
}

/** 5.23: the suggested Home opener, then 1 and 2 reps fewer (never under 1). */
export const homeOpenerChoices = (capReps: number) => {
  const o = homeOpener(capReps);
  return [o, o - 1, o - 2].filter(n => n >= 1);
};

/** An opener she picks is fine at or under the suggested one, never over (3.8). */
export const openerAllowed = (picked: number, suggested: number, floor: number) => picked <= suggested && picked >= floor;

// ---------- declaring ----------

export type ChoiceKey = 'again' | 'same' | 'small' | 'bigger' | 'cap';
/** One declare choice (5.26). `value` is the weight (Barbell) or the reps (Home). */
export type DeclareChoice = { key: ChoiceKey; value: number; disabled: boolean; selected: boolean };

/**
 * 3.8 and look 5.9: "Same weight", "A small step", "A bigger step"; over the cap they show
 * greyed. After a red, "Take it again" (the same weight) comes first and is selected; otherwise
 * "A small step" is selected (or the same weight when the step is over the cap). "Your cap" is a
 * fourth, last and never pre-selected, when the cap is heavier than her last attempt and isn't
 * already one of the three.
 */
export function declareChoices(last: { value: number; red: boolean }, cap: number, step: number, withCap: boolean): DeclareChoice[] {
  const v = last.value;
  const list: DeclareChoice[] = [
    { key: last.red ? 'again' : 'same', value: v, disabled: v > cap, selected: false },
    { key: 'small', value: round(v + step), disabled: round(v + step) > cap, selected: false },
    { key: 'bigger', value: round(v + 2 * step), disabled: round(v + 2 * step) > cap, selected: false },
  ];
  if (withCap && cap > v && !list.some(c => c.value === cap)) list.push({ key: 'cap', value: cap, disabled: false, selected: false });
  const pick = last.red ? list[0] : !list[1].disabled ? list[1] : list[0];
  pick.selected = true;
  return list;
}

export const barbellDeclareChoices = (last: { weight: number; red: boolean }, cap: number, lift: Lift, units: Units) =>
  declareChoices({ value: last.weight, red: last.red }, cap, smallStep(lift, units), true);

/** 3.8a: "Same reps", +1, +2, at or under the cap; no "Your cap" card. */
export const homeDeclareChoices = (last: { reps: number; red: boolean }, capReps: number) =>
  declareChoices({ value: last.reps, red: last.red }, Math.min(HOME_MAX_REPS, capReps), 1, false);

/** The server's check on a declared value: one of the choices, and not greyed. */
export const declareAllowed = (choices: DeclareChoice[], value: number) => choices.some(c => !c.disabled && c.value === value);

// ---------- order ----------

export type Slot = { lift: Lift; number: 1 | 2 | 3 };
/** 3.8: squat 1–3, then bench 1–3, then deadlift 1–3. */
export const ORDER: Slot[] = LIFTS.flatMap(lift => ([1, 2, 3] as const).map(number => ({ lift, number })));
export const slotIndex = (s: { lift: string; number: number }) => ORDER.findIndex(o => o.lift === s.lift && o.number === s.number);

/** An attempt as these rules see it. */
export type MeetAttempt = {
  lift: Lift; number: number; weight: number; repsDeclared: number | null; status: string;
  call: 'white' | 'red' | 'close' | null; recordedAt: Date | null; homeLoad?: number;
  /** when its clip reached us (item 85: a lift that landed after the close) */
  uploadedAt?: Date | null;
  id?: string;
};

/** The slot after her latest attempt, or null after deadlift 3. */
export function nextSlot(list: Pick<MeetAttempt, 'lift' | 'number'>[]): Slot | null {
  const last = Math.max(-1, ...list.map(slotIndex));
  return ORDER[last + 1] ?? null;
}

/** Her current attempt: the latest one by the order. */
export const currentAttempt = <T extends Pick<MeetAttempt, 'lift' | 'number'>>(list: T[]): T | null =>
  list.reduce<T | null>((b, a) => (!b || slotIndex(a) > slotIndex(b) ? a : b), null);

/**
 * When she may declare the next slot: once her current attempt has left the phone (queued,
 * judging, a close call, or judged). A close call never blocks the next attempt (3.8); while
 * judging, the stage offers it from 90 s (5.25 step 8).
 */
export const canDeclareAfter = (status: string) => ['queued', 'judging', 'close_call', 'judged'].includes(status);

/**
 * Where she is on the platform (5.24), walking the nine in order. Her openers may already be on
 * her card (5.23 saves attempt 1 of each lift), so "latest" isn't enough:
 * - a slot with an attempt that hasn't left the phone is the one she lifts now (`current`);
 * - the first slot with no attempt is the one she declares next (`toDeclare`), and `current` is
 *   the attempt before it, whose lights (or wait) she's looking at;
 * - with all nine gone from the phone, `done`.
 */
export function platformState<T extends Pick<MeetAttempt, 'lift' | 'number' | 'status'>>(list: T[]):
  { current: T | null; toDeclare: Slot | null; done: boolean } {
  let prev: T | null = null;
  for (const slot of ORDER) {
    const a = list.find(x => x.lift === slot.lift && x.number === slot.number);
    if (!a) return { current: prev, toDeclare: slot, done: false };
    if (!canDeclareAfter(a.status)) return { current: a, toDeclare: null, done: false };
    prev = a;
  }
  return { current: prev, toDeclare: null, done: true };
}

// ---------- the total ----------

/** A Barbell attempt's number is its weight; a Home attempt's is load × reps on a good lift (3.8a). */
export const attemptScore = (a: MeetAttempt, division: Division) =>
  a.call !== 'white' ? 0 : division === 'home' ? (a.homeLoad ?? a.weight) * (a.repsDeclared ?? 0) : a.weight;

export type Total =
  | { kind: 'lifting' }
  | { kind: 'total'; value: number; best: Record<Lift, MeetAttempt>; nineForNine: boolean; lastCountedAt: Date | null }
  | { kind: 'waiting'; soFar: number; on: MeetAttempt }
  /** after the close, a clip of hers is still sending (5.28 "Waiting on your clip", item 85) */
  | { kind: 'waiting_clip'; soFar: number; on: MeetAttempt }
  | { kind: 'bombed'; lift: Lift };

/**
 * 3.8: her total is the sum of her best good lift in each of the three. A lift with no good
 * lift (and none waiting on a referee) means no total: she bombed out. Pending close calls
 * mean "Total waiting on a referee". It's worked out once her ninth attempt has lights or is a
 * close call; before that she's still lifting.
 *
 * A `void` attempt (item 85: after the close, or sent too late) isn't judged, so it's done and
 * doesn't count. `closed` (the platform has closed): it doesn't wait for all nine. A slot she
 * didn't lift doesn't count; only a clip still sending ("Waiting on your clip") or one with the
 * judges holds it.
 */
export function meetTotal(list: MeetAttempt[], division: Division, closed = false): Total {
  const judged = (a: MeetAttempt) => a.call === 'white' || a.call === 'red' || a.call === 'close' || a.status === 'close_call';
  const nine = ORDER.map(s => list.find(a => a.lift === s.lift && a.number === s.number));
  const all = nine.filter((a): a is MeetAttempt => !!a && (judged(a) || a.status === 'void'));
  // after the close: a clip still sending, or arrived and with the judges, holds the total
  const held = closed ? nine.filter((a): a is MeetAttempt => !!a && !judged(a) && a.status !== 'void' && a.status !== 'declared') : [];
  const sending = held.find(a => a.status === 'recording' || a.status === 'uploading') ?? held[0];
  if (!closed && all.length < ORDER.length) {
    // a lift that has already bombed is known before the ninth, but the page waits for nine
    return { kind: 'lifting' };
  }
  for (const lift of LIFTS) {
    const mine = all.filter(a => a.lift === lift);
    // a clip still sending in this lift may yet be its good lift
    if (!mine.some(a => a.call === 'white' || a.call === 'close' || a.status === 'close_call') && !held.some(a => a.lift === lift)) return { kind: 'bombed', lift };
  }
  const bestOf = (lift: Lift) => all.filter(a => a.lift === lift && a.call === 'white')
    .reduce<MeetAttempt | null>((b, a) => (!b || attemptScore(a, division) > attemptScore(b, division) ? a : b), null);
  const soFar = LIFTS.reduce((s, l) => s + (bestOf(l) ? attemptScore(bestOf(l)!, division) : 0), 0);
  if (sending) return { kind: 'waiting_clip', soFar: round(soFar), on: sending };
  const pending = all.find(a => a.call === 'close' || a.status === 'close_call');
  if (pending) return { kind: 'waiting', soFar: round(soFar), on: pending };
  const best = Object.fromEntries(LIFTS.map(l => [l, bestOf(l)!])) as Record<Lift, MeetAttempt>;
  const times = LIFTS.map(l => best[l].recordedAt).filter((d): d is Date => !!d);
  return {
    kind: 'total', value: round(soFar), best,
    nineForNine: all.length === ORDER.length && all.every(a => a.call === 'white'),
    lastCountedAt: times.length ? new Date(Math.max(...times.map(d => d.getTime()))) : null,
  };
}

/** Her best good lift so far in each lift, as the row and corner show it (null for none yet). */
export const bestSoFar = (list: MeetAttempt[], division: Division) =>
  Object.fromEntries(LIFTS.map(l => {
    const good = list.filter(a => a.lift === l && a.call === 'white');
    return [l, good.length ? Math.max(...good.map(a => attemptScore(a, division))) : null];
  })) as Record<Lift, number | null>;

/** For sorting a board across units (3.3): kg. */
export const toKg = (w: number, units: Units) => (units === 'kg' ? w : w * 0.45359237);

/**
 * 3.8 ties: a higher total (or score) places higher; on a tie, the lifter whose last counted
 * good lift was recorded first places higher, as at a real meet.
 */
export function placeOrder<T extends { total: number; units: Units; lastCountedAt: Date | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const d = toKg(b.total, b.units) - toKg(a.total, a.units);
    if (Math.abs(d) > 1e-6) return d;
    return (a.lastCountedAt?.getTime() ?? Infinity) - (b.lastCountedAt?.getTime() ?? Infinity);
  });
}
