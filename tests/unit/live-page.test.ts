// Meet night, live (plan 5.6): the part of the night, its words, the countdown and the ticker's lamps.
import { describe, expect, it } from 'vitest';
import { countdown, liveEnds, livePhase, liveWhen, meetEyebrow, noStreamYet, tickerLamps } from '@/lib/live-page';

const liveAt = new Date('2027-02-28T01:00:00Z'); // Saturday 8 pm Eastern
const m = { liveAt, streamStartedAt: null, liveMinutes: 60 };

describe('the part of the night', () => {
  it('is before until live_at, live for the live length, then after', () => {
    expect(livePhase(m, new Date('2027-02-28T00:59:59Z'))).toBe('before');
    expect(livePhase(m, liveAt)).toBe('live');
    expect(livePhase(m, new Date('2027-02-28T01:59:59Z'))).toBe('live');
    expect(livePhase(m, new Date('2027-02-28T02:00:00Z'))).toBe('after');
  });
  it('runs from when Soo went live, early or late', () => {
    const late = { ...m, streamStartedAt: new Date('2027-02-28T01:10:00Z') };
    expect(liveEnds(late)).toEqual(new Date('2027-02-28T02:10:00Z'));
    expect(livePhase(late, new Date('2027-02-28T02:05:00Z'))).toBe('live');
    const early = { ...m, streamStartedAt: new Date('2027-02-28T00:55:00Z') };
    expect(livePhase(early, new Date('2027-02-28T00:56:00Z'))).toBe('live');
  });
  it('with no live_at it stays before', () => {
    expect(livePhase({ ...m, liveAt: null }, new Date('2030-01-01'))).toBe('before');
  });
});

describe('the words', () => {
  it('says the day and both coasts', () => {
    expect(liveWhen(liveAt)).toBe('Saturday at 8 pm Eastern · 5 pm Pacific.');
    expect(noStreamYet(liveAt)).toBe("Soo's live starts at 8 pm Eastern (5 pm Pacific).");
    expect(liveWhen(new Date('2027-02-28T01:30:00Z'))).toBe('Saturday at 8:30 pm Eastern · 5:30 pm Pacific.');
  });
  it('the eyebrow and the countdown', () => {
    expect(meetEyebrow('Winter 2027')).toBe('MEET NIGHT · WINTER 2027');
    expect(countdown(((26 * 60 + 5) * 60 + 9) * 1000 + 999)).toBe('26:05:09');
    expect(countdown(-5000)).toBe('0:00:00');
  });
});

describe("the ticker's lamps", () => {
  it("the referee's three lights, or three pulsing on a close call", () => {
    expect(tickerLamps({ call: 'white', status: 'judged', lights: ['white', 'red', 'white'] })).toEqual(['white', 'red', 'white']);
    expect(tickerLamps({ call: 'close', status: 'close_call', lights: null })).toEqual(['pulse', 'pulse', 'pulse']);
    expect(tickerLamps({ call: 'red', status: 'judged', lights: null })).toEqual(['red', 'red', 'red']);
  });
});
