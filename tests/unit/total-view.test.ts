// "You totaled" (5.28): the words and numbers of its three states, with item 75 off (the 1:12 AM
// copy) and on.
import { describe, expect, it } from 'vitest';
import type { MeetAttempt } from '../../web/lib/meet';
import { bombedWords, homeScoreText, homeSum, totalLifts, totalWords, unitLine, waitingBody } from '../../web/lib/total-view';

const a = (lift: MeetAttempt['lift'], weight: number, repsDeclared: number | null = null, homeLoad?: number): MeetAttempt =>
  ({ lift, number: 3, weight, repsDeclared, status: 'judged', call: 'white', recordedAt: null, homeLoad });

describe('You totaled (5.28)', () => {
  it('writes a Home score: a bell as "25 × 8", a pair as "2 × 15 × 10"', () => {
    expect(homeScoreText(a('squat', 25, 8))).toBe('25 × 8');
    expect(homeScoreText(a('squat', 25, 8, 25))).toBe('25 × 8');
    expect(homeScoreText(a('bench', 15, 10, 30))).toBe('2 × 15 × 10');
  });

  it('Barbell: three lifts in Number S, "LB TOTAL"', () => {
    const best = { squat: a('squat', 115), bench: a('bench', 75), deadlift: a('deadlift', 135) };
    expect(totalLifts(best, 'barbell').map(l => [l.label, l.value, l.written])).toEqual([['SQUAT', '115', null], ['BENCH PRESS', '75', null], ['DEADLIFT', '135', null]]);
    expect(unitLine('lb', 'barbell')).toBe('LB TOTAL');
    expect(unitLine('kg', 'barbell')).toBe('KG TOTAL');
  });

  it('Home: the scores written out, their sum, "LB LIFTED"', () => {
    const best = { squat: a('squat', 25, 8, 25), bench: a('bench', 15, 10, 30), deadlift: a('deadlift', 20, 8, 40) };
    const lifts = totalLifts(best, 'home');
    expect(lifts.map(l => l.written)).toEqual(['25 × 8', '2 × 15 × 10', '2 × 20 × 8']);
    expect(lifts.map(l => l.value)).toEqual(['200', '300', '320']);
    expect(homeSum(best)).toBe('25 × 8 + 2 × 15 × 10 + 2 × 20 × 8');
    expect(unitLine('lb', 'home')).toBe('LB LIFTED');
  });

  it('switched off (1:12 AM): Soo reads her name, "See my meet card", "Watch meet night", demo or not', () => {
    for (const demo of [true, false]) {
      const w = totalWords(demo, false);
      expect(w.body).toBe("That's your first total. Soo is live at 8 pm Eastern tonight. Every woman who totaled is on her screen. Watch for your name.");
      expect(w.primary).toEqual({ label: 'See my meet card', href: '/me/card' });
      expect(w.ghost).toEqual({ label: 'Watch meet night', href: '/live' });
    }
  });

  it('item 75 on: a demo lifter is told about a real meet night; "See my lifts" until phase 4', () => {
    expect(totalWords(true, true)).toEqual({
      body: "That's your first total. On a real meet night, every woman who totaled is on the host's screen.",
      primary: { label: 'See my lifts', href: '/platform' },
      ghost: { label: 'Watch a meet night', href: '/sample' },
    });
    const real = totalWords(false, true);
    expect(real.body).toMatch(/Soo is live at 8 pm Eastern tonight/);
    expect(real.primary).toEqual({ label: 'See my lifts', href: '/platform' });
    expect(real.ghost).toEqual({ label: 'Watch meet night', href: '/live' });
  });

  it('bombed out: the lift she missed, the free meet, "See my lifts" in both copies', () => {
    for (const item75 of [false, true]) {
      const b = bombedWords('bench', 'home', false, item75, false);
      expect(b.body).toBe("Bombed out happens to champions. You didn't get a good overhead press this time, so there's no total, but every lift still counts in your training log.");
      expect(b.free).toBe("Your next meet is free. We've added it to your account.");
      expect(b.primary).toEqual({ label: 'See my lifts', href: '/platform' });
    }
    expect(bombedWords('squat', 'barbell', true, true).ghost.href).toBe('/sample');
    // item 77: a demo lifter reads what a real meet would do; a real lifter's line doesn't change
    expect(bombedWords('squat', 'barbell', true, false, true).free).toBe('In a real meet, your next meet would be free.');
    expect(bombedWords('squat', 'barbell', true, true, true).free).toBe('In a real meet, your next meet would be free.');
    expect(bombedWords('squat', 'barbell', true, false, false).free).toBe("Your next meet is free. We've added it to your account.");
    expect(bombedWords('squat', 'barbell', false, false, true).free).toBe("Your next meet is free. We've added it to your account.");
    expect(bombedWords('squat', 'barbell', true, false).ghost.href).toBe('/live');
  });

  it('waiting on a referee names the attempt', () => {
    expect(waitingBody({ lift: 'deadlift', number: 3 }, 'barbell')).toBe("A referee is still looking at Deadlift 3. Your total lands as soon as they're done. Usually within 15 minutes.");
  });
});
