// The part of her attempt her clip shows (piece 7, 3.9 step 6), and that the clip fits in 15 s.
import { describe, expect, it } from 'vitest';
import { CLIP_MAX_MS, clipLength, clipWindow, FOOTAGE_MAX_MS } from '@/lib/card/clip-job';

const rep = (frame_ms: number, call: 'white' | 'red' = 'white') => ({ frame_ms, call }) as never;

describe('her clip\'s window', () => {
  it('Barbell: half a second before the first command to a second after the last', () => {
    expect(clipWindow({ call: 'white', repLights: null, commandTimes: { loaded: 1200, squat: 3000, rack: 6500 } })).toEqual({ startMs: 700, endMs: 7500 });
  });
  it('never longer than the footage allowed: the end stays', () => {
    const w = clipWindow({ call: 'white', repLights: null, commandTimes: { loaded: 1000, squat: 3000, rack: 20_000 } });
    expect(w.endMs).toBe(21_000);
    expect(w.endMs - w.startMs).toBe(FOOTAGE_MAX_MS);
  });
  it('Home, white: her last 3 reps', () => {
    const reps = [2000, 4000, 6000, 8000, 10_000].map(ms => rep(ms));
    expect(clipWindow({ call: 'white', repLights: reps, commandTimes: { loaded: 500, rack: 11_000 } })).toEqual({ startMs: 5000, endMs: 12_000 });
  });
  it('Home, red: the missed rep and the 2 before it', () => {
    const reps = [rep(2000), rep(4000), rep(6000), rep(8000, 'red'), rep(10_000)];
    expect(clipWindow({ call: 'red', repLights: reps, commandTimes: { loaded: 500, rack: 11_000 } })).toEqual({ startMs: 3000, endMs: 9000 });
  });
  it('the whole clip is 15 s or less', () => {
    expect(clipLength(FOOTAGE_MAX_MS)).toBeLessThanOrEqual(CLIP_MAX_MS);
  });
});
