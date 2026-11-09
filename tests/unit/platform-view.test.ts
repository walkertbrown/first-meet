// The platform's own pieces (5.24–5.27): the 9-attempt row, the card's because line, the countdown.
import { describe, expect, it } from 'vitest';
import { becauseLine, nineRow } from '../../web/lib/platform-view';
import { opensInText } from '../../web/components/opens-in';

const at = new Date('2026-11-03T15:00:00Z');

describe('the 9-attempt row (look 4)', () => {
  it('nine slots in the meet\'s order, empty before anything is declared', () => {
    const row = nineRow([], null);
    expect(row.map(c => `${c.lift}${c.number}`)).toEqual(['squat1', 'squat2', 'squat3', 'bench1', 'bench2', 'bench3', 'deadlift1', 'deadlift2', 'deadlift3']);
    expect(row.every(c => c.state === 'empty')).toBe(true);
  });

  it('lights, a close call waiting, the one she lifts now, and the openers on her card', () => {
    const row = nineRow([
      { lift: 'squat', number: 1, status: 'judged', call: 'white' },
      { lift: 'squat', number: 2, status: 'judged', call: 'red' },
      { lift: 'squat', number: 3, status: 'close_call', call: null },
      { lift: 'bench', number: 1, status: 'declared', call: null },
      { lift: 'deadlift', number: 1, status: 'declared', call: null },
    ], { lift: 'bench', number: 1 });
    expect(row.map(c => c.state)).toEqual(['white', 'red', 'waiting', 'now', 'empty', 'empty', 'declared', 'empty', 'empty']);
  });

  it('a sent attempt still waiting on the queue isn\'t lit', () => {
    const row = nineRow([{ lift: 'squat', number: 1, status: 'queued', call: null }], null);
    expect(row[0].state).toBe('sent');
    expect(nineRow([{ lift: 'squat', number: 1, status: 'queued', call: null }], { lift: 'squat', number: 1 })[0].state).toBe('now');
  });
});

describe('the because line (5.25 step 1)', () => {
  it('judged Barbell: the triple, its date, "lighter"', () => {
    expect(becauseLine('barbell', 'squat', { cap: 225, judged: true, at, weight: 225, kind: null }, 'lb'))
      .toBe('You squatted 225 for 3 with white lights on Nov 3. This one is lighter, so it\'s already yours.');
    expect(becauseLine('barbell', 'bench', { cap: 100, judged: true, at, weight: 100, kind: null }, 'kg')).toMatch(/^You benched 100 for 3/);
  });

  it('judged Home: the reps at the weight, "fewer"', () => {
    expect(becauseLine('home', 'deadlift', { cap: 12, judged: true, at, weight: 35, kind: 'pair' }, 'lb'))
      .toBe('You did 12 at 35 lb with white lights on Nov 3. This one is fewer, so it\'s already yours.');
  });

  it('not judged in training', () => {
    expect(becauseLine('barbell', 'squat', { cap: 225, judged: false, at: null, weight: 225, kind: null }, 'lb'))
      .toBe('Lighter than your best logged triple. Not judged in training yet.');
    expect(becauseLine('home', 'squat', { cap: 12, judged: false, at: null, weight: 35, kind: 'bell' }, 'lb'))
      .toBe('Fewer than your best logged set. Not judged in training yet.');
  });
});

describe('the countdown before the platform opens (5.24)', () => {
  it('days, hours and minutes, rounded up to the minute', () => {
    expect(opensInText(((2 * 24 + 3) * 60 + 7) * 60_000)).toBe('2d 3h 7m');
    expect(opensInText((3 * 60) * 60_000)).toBe('3h 0m');
    expect(opensInText(61_000)).toBe('2m');
    expect(opensInText(1)).toBe('1m');
    expect(opensInText(-5000)).toBe('0m');
  });
});
