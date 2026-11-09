// Piece 10's test (plan 3.8, 3.8a): every attempt rule, one by one.
import { describe, expect, it } from 'vitest';
import {
  ORDER, barbellCap, barbellDeclareChoices, barbellOpener, barbellOpenerChoices, bestSoFar, bigStep, canDeclareAfter,
  countedReps, currentAttempt, declareAllowed, homeCap, homeDeclareChoices, homeLoad, homeOpener, homeOpenerChoices,
  homeWeightChoices, meetTotal, nextSlot, openerAllowed, placeOrder, smallStep, type JudgedSet, type LoggedSet, type MeetAttempt,
} from './meet';
import type { Lift } from '@/db/schema';

const d = (day: number) => new Date(Date.UTC(2027, 0, day));
const white = (n: number) => Array.from({ length: n }, () => ({ call: 'white' as const, reason: null }));
const js = (o: Partial<JudgedSet>): JudgedSet => ({ movement: 'squat', weight: 100, reps: 3, allWhite: true, lights: white(o.reps ?? 3), week: 5, at: d(1), ...o });
const ls = (o: Partial<LoggedSet>): LoggedSet => ({ movement: 'squat', weight: 100, reps: 3, week: 5, at: d(1), ...o });

describe('3.3 steps', () => {
  it('lb: squat and deadlift 10, bench 5; kg: 5 and 2.5; the bigger step is twice', () => {
    expect([smallStep('squat', 'lb'), smallStep('deadlift', 'lb'), smallStep('bench', 'lb')]).toEqual([10, 10, 5]);
    expect([smallStep('squat', 'kg'), smallStep('deadlift', 'kg'), smallStep('bench', 'kg')]).toEqual([5, 5, 2.5]);
    expect(bigStep('bench', 'kg')).toBe(5);
    expect(bigStep('squat', 'lb')).toBe(20);
  });
});

describe('3.8 her cap (Barbell)', () => {
  it('is the heaviest all-white judged set of 3+ reps from weeks 2–11', () => {
    const c = barbellCap('squat', [js({ weight: 95 }), js({ weight: 115, at: d(9) }), js({ weight: 105 })], [], 'lb');
    expect(c).toEqual({ weight: 115, judged: true, at: d(9) });
  });
  it('ignores sets that are not all white, under 3 reps, week 1 or week 12, or another lift', () => {
    const c = barbellCap('squat', [
      js({ weight: 95 }),
      js({ weight: 135, allWhite: false }),
      js({ weight: 135, reps: 2 }),
      js({ weight: 135, week: 1 }),
      js({ weight: 135, week: 12 }),
      js({ weight: 135, movement: 'deadlift' }),
    ], [ls({ weight: 200 })], 'lb');
    expect(c.weight).toBe(95);
    expect(c.judged).toBe(true);
  });
  it('with no judged set: her best logged set of 3+ reps, "Not judged yet"', () => {
    const c = barbellCap('bench', [], [ls({ movement: 'bench', weight: 70 }), ls({ movement: 'bench', weight: 80, reps: 2 }), ls({ movement: 'bench', weight: 65 })], 'lb');
    expect(c).toMatchObject({ weight: 70, judged: false });
  });
  it('with no logged sets either (a late joiner): the bar', () => {
    expect(barbellCap('deadlift', [], [], 'lb')).toEqual({ weight: 45, judged: false, at: null });
    expect(barbellCap('deadlift', [], [], 'kg')).toMatchObject({ weight: 20 });
    expect(barbellCap('deadlift', [], [], 'lb', 35)).toMatchObject({ weight: 35 });
  });
});

describe('3.8 the suggested opener', () => {
  it('is 90% of the cap rounded down to the small step (the demo: 115, 75, 135 → 100, 65, 120)', () => {
    expect(barbellOpener(115, 'squat', 'lb')).toBe(100);
    expect(barbellOpener(75, 'bench', 'lb')).toBe(65);
    expect(barbellOpener(135, 'deadlift', 'lb')).toBe(120);
    expect(barbellOpener(100, 'squat', 'kg')).toBe(90);
    expect(barbellOpener(52.5, 'bench', 'kg')).toBe(45); // 47.25 → 45
    expect(barbellOpener(55, 'bench', 'kg')).toBe(47.5); // 49.5 → 47.5
  });
  it('is the cap minus a small step when 90% rounds to the cap itself', () => {
    expect(barbellOpener(55, 'bench', 'lb')).toBe(45); // 49.5 → 45
    expect(barbellOpener(10, 'bench', 'lb', 5)).toBe(5); // 9 → 5, and 5 < 10
    expect(barbellOpener(5, 'bench', 'lb', 0)).toBe(0); // 4.5 → 0 (cap − step would be 0 too)
    expect(barbellOpener(2.5, 'bench', 'kg', 0)).toBe(0);
  });
  it('is never below the bar', () => {
    expect(barbellOpener(45, 'squat', 'lb')).toBe(45);
    expect(barbellOpener(50, 'squat', 'lb')).toBe(45);
    expect(barbellOpener(20, 'bench', 'kg')).toBe(20);
  });
  it('climbs opener → a step → the cap on the third (100 → 110 → 115)', () => {
    const cap = 115;
    const a1 = barbellOpener(cap, 'squat', 'lb');
    const c1 = barbellDeclareChoices({ weight: a1, red: false }, cap, 'squat', 'lb');
    const a2 = c1.find(c => c.selected)!.value;
    const c2 = barbellDeclareChoices({ weight: a2, red: false }, cap, 'squat', 'lb');
    expect([a1, a2]).toEqual([100, 110]);
    expect(c2.find(c => c.key === 'cap')?.value).toBe(115);
  });
  it('meet week offers it, then one and two small steps lighter, never below the bar', () => {
    expect(barbellOpenerChoices(115, 'squat', 'lb')).toEqual([100, 90, 80]);
    expect(barbellOpenerChoices(75, 'bench', 'lb')).toEqual([65, 60, 55]);
    expect(barbellOpenerChoices(55, 'squat', 'lb')).toEqual([45]);
  });
  it('she may pick lower than suggested, never higher', () => {
    expect(openerAllowed(90, 100, 45)).toBe(true);
    expect(openerAllowed(110, 100, 45)).toBe(false);
    expect(openerAllowed(40, 100, 45)).toBe(false);
  });
});

describe('3.8 declaring', () => {
  it('offers the same weight, a small step and a bigger step; "A small step" is selected', () => {
    const c = barbellDeclareChoices({ weight: 100, red: false }, 135, 'squat', 'lb');
    expect(c.map(x => [x.key, x.value, x.disabled])).toEqual([['same', 100, false], ['small', 110, false], ['bigger', 120, false], ['cap', 135, false]]);
    expect(c.find(x => x.selected)?.key).toBe('small');
  });
  it('greys any choice over the cap, and never allows it', () => {
    const c = barbellDeclareChoices({ weight: 110, red: false }, 115, 'squat', 'lb');
    expect(c.map(x => [x.key, x.value, x.disabled])).toEqual([['same', 110, false], ['small', 120, true], ['bigger', 130, true], ['cap', 115, false]]);
    expect(declareAllowed(c, 120)).toBe(false);
    expect(declareAllowed(c, 115)).toBe(true);
  });
  it('selects the same weight when even the small step is over the cap', () => {
    const c = barbellDeclareChoices({ weight: 115, red: false }, 115, 'squat', 'lb');
    expect(c.find(x => x.selected)?.key).toBe('same');
  });
  it('the next attempt is never lighter than the last', () => {
    const c = barbellDeclareChoices({ weight: 100, red: true }, 115, 'squat', 'lb');
    expect(Math.min(...c.map(x => x.value))).toBe(100);
    expect(declareAllowed(c, 90)).toBe(false);
  });
  it('adds "Your cap" only when it is heavier than her last and not already one of the three, last and never selected', () => {
    expect(barbellDeclareChoices({ weight: 100, red: false }, 110, 'squat', 'lb').some(c => c.key === 'cap')).toBe(false); // 110 is the small step
    expect(barbellDeclareChoices({ weight: 100, red: false }, 120, 'squat', 'lb').some(c => c.key === 'cap')).toBe(false); // the bigger step
    expect(barbellDeclareChoices({ weight: 115, red: false }, 115, 'squat', 'lb').some(c => c.key === 'cap')).toBe(false); // not heavier
    const c = barbellDeclareChoices({ weight: 65, red: false }, 72.5, 'bench', 'lb');
    expect(c.at(-1)).toMatchObject({ key: 'cap', value: 72.5, selected: false });
  });
  it('after a red, "Take it again" (the same weight) comes first and is selected', () => {
    const c = barbellDeclareChoices({ weight: 110, red: true }, 115, 'squat', 'lb');
    expect(c[0]).toMatchObject({ key: 'again', value: 110, selected: true });
    expect(c.filter(x => x.selected)).toHaveLength(1);
  });
  it('the third attempt can always reach the cap', () => {
    for (const cap of [95, 105, 115, 125, 135, 145]) {
      for (const red of [false, true]) {
        const a1 = barbellOpener(cap, 'squat', 'lb');
        const pick = barbellDeclareChoices({ weight: a1, red }, cap, 'squat', 'lb').find(c => c.selected)!.value;
        const third = barbellDeclareChoices({ weight: pick, red: false }, cap, 'squat', 'lb');
        expect(declareAllowed(third, cap)).toBe(true);
      }
    }
  });
});

describe('3.8 order', () => {
  it('is squat 1–3, then bench 1–3, then deadlift 1–3', () => {
    expect(ORDER.map(s => `${s.lift}${s.number}`)).toEqual(['squat1', 'squat2', 'squat3', 'bench1', 'bench2', 'bench3', 'deadlift1', 'deadlift2', 'deadlift3']);
  });
  it('the next slot follows her latest attempt, and there is none after deadlift 3', () => {
    expect(nextSlot([])).toEqual({ lift: 'squat', number: 1 });
    expect(nextSlot([{ lift: 'squat', number: 1 }, { lift: 'squat', number: 2 }])).toEqual({ lift: 'squat', number: 3 });
    expect(nextSlot([{ lift: 'squat', number: 3 }])).toEqual({ lift: 'bench', number: 1 });
    expect(nextSlot([{ lift: 'deadlift', number: 3 }])).toBeNull();
    expect(currentAttempt([{ lift: 'bench', number: 1 }, { lift: 'squat', number: 3 }])).toEqual({ lift: 'bench', number: 1 });
  });
  it('she declares each before lifting it; a close call does not block the next attempt', () => {
    expect(canDeclareAfter('declared')).toBe(false);
    expect(canDeclareAfter('recording')).toBe(false);
    expect(canDeclareAfter('uploading')).toBe(false);
    expect(canDeclareAfter('close_call')).toBe(true);
    expect(canDeclareAfter('judged')).toBe(true);
    expect(canDeclareAfter('judging')).toBe(true); // offered from 90 s on the stage (5.25 step 8)
  });
});

const at = (lift: Lift, number: number, weight: number, call: MeetAttempt['call'], t = number, reps: number | null = null): MeetAttempt =>
  ({ lift, number, weight, repsDeclared: reps, status: call === 'close' ? 'close_call' : 'judged', call, recordedAt: d(t + (lift === 'bench' ? 3 : lift === 'deadlift' ? 6 : 0)) });
const nine = (calls: MeetAttempt['call'][], weights = [100, 110, 115, 65, 70, 75, 120, 130, 135]) =>
  ORDER.map((s, i) => at(s.lift, s.number, weights[i], calls[i]));

describe('3.8 the total', () => {
  it('is the sum of the heaviest good lift in each of the three', () => {
    const t = meetTotal(nine(['white', 'white', 'red', 'white', 'red', 'red', 'white', 'white', 'white']), 'barbell');
    expect(t).toMatchObject({ kind: 'total', value: 110 + 65 + 135, nineForNine: false });
  });
  it('9 for 9 when all nine are good', () => {
    const t = meetTotal(nine(Array(9).fill('white')), 'barbell');
    expect(t).toMatchObject({ kind: 'total', value: 325, nineForNine: true });
  });
  it('waits for the ninth attempt', () => {
    expect(meetTotal(nine(Array(9).fill('white')).slice(0, 8), 'barbell')).toEqual({ kind: 'lifting' });
    const pending = nine(Array(9).fill('white'));
    pending[8] = { ...pending[8], call: null, status: 'judging' };
    expect(meetTotal(pending, 'barbell')).toEqual({ kind: 'lifting' });
  });
  it('with no good lift in any one of the three, she bombed out', () => {
    const t = meetTotal(nine(['white', 'white', 'white', 'red', 'red', 'red', 'white', 'white', 'white']), 'barbell');
    expect(t).toEqual({ kind: 'bombed', lift: 'bench' });
  });
  it('pending close calls mean "Total waiting on a referee", with the total so far', () => {
    const t = meetTotal(nine(['white', 'white', 'white', 'white', 'white', 'white', 'white', 'white', 'close']), 'barbell');
    expect(t).toMatchObject({ kind: 'waiting', soFar: 115 + 75 + 130 });
    if (t.kind === 'waiting') expect(t.on).toMatchObject({ lift: 'deadlift', number: 3 });
  });
  it('a close call is not a bomb-out until the referee says so', () => {
    const t = meetTotal(nine(['white', 'white', 'white', 'red', 'red', 'close', 'white', 'white', 'white']), 'barbell');
    expect(t.kind).toBe('waiting');
    const done = meetTotal(nine(['white', 'white', 'white', 'red', 'red', 'red', 'white', 'white', 'close']), 'barbell');
    expect(done.kind).toBe('bombed'); // bench has bombed whatever deadlift 3 turns out to be
  });
  it('her best so far shows each lift as it lands', () => {
    expect(bestSoFar([at('squat', 1, 100, 'white'), at('squat', 2, 110, 'red')], 'barbell')).toEqual({ squat: 100, bench: null, deadlift: null });
  });
});

describe('3.8 ties', () => {
  it('a higher total places higher, across units', () => {
    const r = placeOrder([
      { id: 'a', total: 300, units: 'lb' as const, lastCountedAt: d(1) },
      { id: 'b', total: 140, units: 'kg' as const, lastCountedAt: d(1) },
    ]);
    expect(r.map(x => x.id)).toEqual(['b', 'a']); // 140 kg is 308.6 lb
  });
  it('on a tie, the lifter whose last counted good lift was recorded first places higher', () => {
    const r = placeOrder([
      { id: 'late', total: 300, units: 'lb' as const, lastCountedAt: d(9) },
      { id: 'early', total: 300, units: 'lb' as const, lastCountedAt: d(2) },
    ]);
    expect(r.map(x => x.id)).toEqual(['early', 'late']);
  });
  it('the last counted lift is the latest of her three best', () => {
    const t = meetTotal(nine(['white', 'white', 'white', 'white', 'red', 'red', 'white', 'red', 'red']), 'barbell');
    expect(t.kind === 'total' && t.lastCountedAt).toEqual(d(7)); // deadlift 1, recorded at d(1 + 6)
  });
});

describe('3.8a Home: her meet weight', () => {
  const owned = [{ weight: 15, kind: 'pair' as const }, { weight: 20, kind: 'pair' as const }, { weight: 25, kind: 'bell' as const }];
  it('defaults to the weight that scores highest (weight × her cap at it), not the heaviest', () => {
    const r = homeWeightChoices('squat', [js({ weight: 15, reps: 12, lights: white(12) }), js({ weight: 20, reps: 6, lights: white(6) })], [], owned);
    expect(r.choices.map(c => [c.weight, c.score])).toEqual([[15, 180], [20, 120]]);
    expect(r.best?.weight).toBe(15);
  });
  it('the floor press counts the pair in its score', () => {
    const r = homeWeightChoices('bench', [js({ movement: 'bench', weight: 15, reps: 10, lights: white(10) })], [], owned);
    expect(r.best).toMatchObject({ weight: 15, kind: 'pair', score: 300 });
  });
  it('ties go to the heavier weight', () => {
    const r = homeWeightChoices('squat', [js({ weight: 10, reps: 12, lights: white(12) }), js({ weight: 20, reps: 6, lights: white(6) })], [], owned);
    expect(r.best?.weight).toBe(20);
  });
  it('lists only weights with a judged set with at least 1 white rep', () => {
    const red = [{ call: 'red' as const, reason: 'depth' }, { call: 'red' as const, reason: 'depth' }, { call: 'red' as const, reason: 'depth' }];
    const r = homeWeightChoices('squat', [js({ weight: 25, allWhite: false, lights: red }), js({ weight: 15, reps: 8, lights: white(8) })], [], owned);
    expect(r.choices.map(c => c.weight)).toEqual([15]);
  });
  it('with no judged set, the weight of her best logged set, not judged', () => {
    const r = homeWeightChoices('deadlift', [], [ls({ movement: 'deadlift', weight: 20, reps: 10 }), ls({ movement: 'deadlift', weight: 15, reps: 10 })], owned);
    expect(r.best).toMatchObject({ weight: 20, capReps: 10, judged: false, score: 400 });
  });
});

describe('3.8a Home: her cap', () => {
  it('is the most counted reps in a judged set at her meet weight', () => {
    const c = homeCap('squat', 25, [js({ weight: 25, reps: 9, lights: white(9) }), js({ weight: 25, reps: 12, lights: white(12), at: d(4) }), js({ weight: 20, reps: 15, lights: white(15) })], []);
    expect(c).toEqual({ reps: 12, weight: 25, judged: true, at: d(4) });
  });
  it('counts all reps of an all-white set', () => {
    expect(countedReps(js({ reps: 8, lights: white(8) }))).toBe(8);
  });
  it('in the last set of weeks 8–11 only, counts the white reps before the first red or close one', () => {
    const lights = [...white(6), { call: 'close' as const, reason: 'borderline_depth' }, { call: 'white' as const, reason: null }];
    expect(countedReps(js({ reps: 8, allWhite: false, lights, week: 9, lastSetOfWeek: true }))).toBe(6);
    expect(countedReps(js({ reps: 8, allWhite: false, lights, week: 9, lastSetOfWeek: false }))).toBe(0);
    expect(countedReps(js({ reps: 8, allWhite: false, lights, week: 7, lastSetOfWeek: true }))).toBe(0);
    expect(countedReps(js({ reps: 8, allWhite: false, lights, week: 12, lastSetOfWeek: true }))).toBe(0);
  });
  it('with no judged set, is the most logged reps at that weight', () => {
    expect(homeCap('bench', 15, [], [ls({ movement: 'bench', weight: 15, reps: 11 }), ls({ movement: 'bench', weight: 20, reps: 14 })])).toMatchObject({ reps: 11, judged: false });
  });
  it('is never more than 20', () => {
    expect(homeCap('squat', 15, [js({ weight: 15, reps: 25, lights: white(25) })], []).reps).toBe(20);
    expect(homeCap('squat', 15, [], [ls({ weight: 15, reps: 30 })]).reps).toBe(20);
  });
});

describe('3.8a Home: openers, declaring, scores', () => {
  it('the opener is 90% of the cap in reps, rounded down (the demo: 12 → 10)', () => {
    expect(homeOpener(12)).toBe(10);
    expect(homeOpener(20)).toBe(18);
    expect(homeOpener(5)).toBe(4);
  });
  it('is at least 1 rep under the cap when the cap is 2 or more', () => {
    expect(homeOpener(2)).toBe(1);
    expect(homeOpener(3)).toBe(2);
    expect(homeOpener(9)).toBe(8);
    expect(homeOpener(1)).toBe(1);
  });
  it('meet week offers it, then 1 and 2 reps fewer', () => {
    expect(homeOpenerChoices(12)).toEqual([10, 9, 8]);
    expect(homeOpenerChoices(2)).toEqual([1]);
  });
  it('declares "Same reps", +1 and +2, at or under the cap, with no "Your cap" card (10 → 11 → 12)', () => {
    const c = homeDeclareChoices({ reps: 10, red: false }, 12);
    expect(c.map(x => [x.key, x.value, x.disabled])).toEqual([['same', 10, false], ['small', 11, false], ['bigger', 12, false]]);
    expect(c.find(x => x.selected)?.value).toBe(11);
    const c2 = homeDeclareChoices({ reps: 11, red: false }, 12);
    expect(c2.map(x => x.disabled)).toEqual([false, false, true]);
  });
  it('after a red, "Take it again" comes first and is selected; never fewer reps than the last', () => {
    const c = homeDeclareChoices({ reps: 11, red: true }, 12);
    expect(c[0]).toMatchObject({ key: 'again', value: 11, selected: true });
    expect(declareAllowed(c, 10)).toBe(false);
  });
  it('a score is weight × reps, the floor press counting the pair (2 × 15 lb for 10 reps is 300)', () => {
    expect(homeLoad('bench', 15, 'pair') * 10).toBe(300);
    expect(homeLoad('squat', 25, 'bell') * 8).toBe(200);
    expect(homeLoad('deadlift', 20, 'pair')).toBe(40);
    expect(homeLoad('deadlift', 25, 'bell')).toBe(25);
  });
  it('her Home total is the sum of her best good attempt in each lift', () => {
    const h = (lift: Lift, n: number, reps: number, call: MeetAttempt['call'], load: number) => ({ ...at(lift, n, load, call, n, reps), homeLoad: load });
    const list = [
      h('squat', 1, 10, 'white', 25), h('squat', 2, 11, 'white', 25), h('squat', 3, 12, 'red', 25),
      h('bench', 1, 10, 'white', 30), h('bench', 2, 11, 'red', 30), h('bench', 3, 11, 'red', 30),
      h('deadlift', 1, 10, 'white', 40), h('deadlift', 2, 11, 'white', 40), h('deadlift', 3, 12, 'white', 40),
    ];
    const t = meetTotal(list, 'home');
    expect(t).toMatchObject({ kind: 'total', value: 25 * 11 + 30 * 10 + 40 * 12 });
  });
});
