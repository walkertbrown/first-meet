import { describe, expect, it } from 'vitest';
import { keepWhole, meetAway } from '@/lib/site';
import { meetLineBold } from '@/lib/stage/try-words';

// Look 4, type: a date, a number with its unit, and a time never break across a line.
const breaks = (s: string) => [...s].filter(c => c === ' ').length;

describe('keepWhole', () => {
  it('keeps a short date range whole', () => {
    expect(keepWhole('Feb 26–27')).toBe('Feb 26⁠–⁠27');
  });
  it('keeps a long date range whole', () => {
    expect(breaks(keepWhole('Fri Feb 26 – Sat Feb 27'))).toBe(0);
  });
  it('keeps a time and a count with their units, and leaves other words free', () => {
    const s = keepWhole('Soo is live Saturday at 8 pm Eastern');
    expect(s).toContain('8 pm');
    expect(s).toContain('Soo is live');
    expect(keepWhole('16 weeks away')).toBe('16 weeks away');
  });
  it('is in the countdown and the meet line', () => {
    expect(meetAway(new Date('2026-11-08T12:00:00Z'))).toMatch(/^\d+ weeks away$/);
    expect(meetLineBold('Winter meet', 'Feb 26–27', '16 weeks away')).toBe('Winter meet · Feb 26⁠–⁠27 · 16 weeks away.');
  });
});
