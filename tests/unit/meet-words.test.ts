// A meet attempt's words (5.25 step 9, 3.5, the Barbell loading line).
import { describe, expect, it } from 'vitest';
import { barLoading, meetResult, MEET_WORDS } from '../../web/lib/stage/meet-words';
import { estimateMinutes } from '../../web/lib/attempt-state';
import { isFor } from '../../web/lib/live';

const a = (o: Partial<Parameters<typeof meetResult>[0]>) => ({ call: null, lights: null, reason: null, red_rep: null, reps_declared: null, ...o });

describe('meet words', () => {
  it('white, red with the meet\'s depth sentence, close call', () => {
    expect(meetResult(a({ call: 'white' }))).toMatchObject({ title: 'Good lift', body: 'Your hips went below your knees and you stood tall. A referee would pass that.', lamps: ['white', 'white', 'white'] });
    const red = meetResult(a({ call: 'red', reason: 'depth' }))!;
    expect(red.reason).toEqual({ eyebrow: 'DEPTH', text: 'Almost. Your hips stopped just above your knees. Sit back a little further and take it again.' });
    expect(red.body).toBe('Red lights happen to everyone, even world champions. Most women take it again.');
    expect(meetResult(a({ call: 'close' }))).toMatchObject({ title: 'Close call', lamps: ['off', 'off', 'off'] });
    expect(meetResult(a({}))).toBeNull();
  });

  it('a referee\'s 2–1, both ways', () => {
    expect(meetResult(a({ call: 'white', lights: ['white', 'red', 'white'] }))!.small).toBe('Two white lights and one red. Two whites is a good lift.');
    expect(meetResult(a({ call: 'red', reason: 'no_lockout', lights: ['red', 'white', 'red'] }))).toMatchObject({ small: 'One white light and two red.', lamps: ['red', 'white', 'red'] });
  });

  it('Home: the set as declared, and the red rep named', () => {
    expect(meetResult(a({ call: 'white', reps_declared: 10 }))!.body).toBe('All 10 reps counted. A referee would pass that.');
    expect(meetResult(a({ call: 'red', reason: 'depth', reps_declared: 10, red_rep: 6 }))!.reason!.eyebrow).toBe('REP 6 · DEPTH');
  });

  it('the loading line', () => {
    expect(barLoading(100)).toBe('45 lb bar + a green 25 and a 2½ on each side');
    expect(barLoading(185)).toBe('45 lb bar + a blue 45 and a green 25 on each side');
    expect(barLoading(75)).toBe('45 lb bar + a white 10 and a 5 on each side');
    expect(barLoading(405)).toBe('45 lb bar + a blue 45, a blue 45, a blue 45 and a blue 45 on each side');
    expect(barLoading(415)).toMatch(/^45 lb bar \+ a red 55/);
    expect(barLoading(45)).toBe('45 lb bar');
    expect(barLoading(60, 'kg')).toBe('20 kg bar + a blue 20 on each side');
  });

  it('the 90 s line', () => {
    expect(MEET_WORDS.busy90(3)).toBe('Busy platform. Your lights in about 3 minutes.');
  });
});

describe('the wait estimate (3.9 step 8)', () => {
  it('clip seconds ahead ÷ clip seconds finished a minute, + the median pose time, rounded up', () => {
    // 300 s ahead, 150 s finished in 5 min (30 s/min) → 10 min, + 45 s → 10.75 → 11
    expect(estimateMinutes(300, 150, 45)).toBe(11);
    expect(estimateMinutes(0, 0, null)).toBe(1);
    expect(estimateMinutes(120, 0, 60)).toBe(3);
  });
});

describe('live events reach only their lifter', () => {
  const ev = { kind: 'attempt' as const, attempt_id: 'a1', lifter_id: 'L1', status: 'judged' };
  it('her own, or the attempt she watches', () => {
    expect(isFor(ev, 'L1', null)).toBe(true);
    expect(isFor(ev, 'L2', 'a1')).toBe(false);
    expect(isFor({ kind: 'attempt', attempt_id: 'a1', status: 'changed' } as never, 'L2', 'a1')).toBe(true);
    expect(isFor({ kind: 'attempt', attempt_id: 'a1', status: 'changed' } as never, 'L2', 'a2')).toBe(false);
    expect(isFor({ kind: 'close_calls', attempt_id: 'a1' }, 'L1', 'a1')).toBe(false);
  });
});
