// The bench's frames (3.4d step 1): framesJob's "Start!", "Press!", "Rack!" and saved bar path for make_frames.
// A late Press! after a lost track (3.4b) is `press_late`, next to `press_late_why: "lost"`, a word, not a time.
import { describe, expect, it } from 'vitest';
import { benchBlock, commandList } from '@/lib/referee/bot';
import type { BarPoint } from '@/lib/judge/bar-measure';

describe('benchBlock', () => {
  it('takes an on-time Press!', () => {
    expect(benchBlock({ loaded: 0, start: 1500, press: 4200, rack: 6100 })).toEqual({ start_ms: 1500, press_ms: 4200, rack_ms: 6100 });
  });
  it('takes a late Press!, whatever order the keys come in', () => {
    const want = { start_ms: 1500, press_ms: 5000, rack_ms: 8000 };
    expect(benchBlock({ loaded: 0, start: 1500, press_late_why: 'lost', press_late: 5000, rack: 8000 } as never)).toEqual(want);
    expect(benchBlock({ loaded: 0, start: 1500, press_late: 5000, press_late_why: 'lost', rack: 8000 } as never)).toEqual(want);
  });
  it('is null with no Start!', () => {
    expect(benchBlock({ loaded: 0, press: 4200 })).toBeNull();
    expect(benchBlock(null)).toBeNull();
  });
  it('with no Press! (the bar never stopped) still goes, so the worker finds the touch and lockout to Rack!', () => {
    expect(benchBlock({ loaded: 0, start: 1500, rack: 6100 })).toEqual({ start_ms: 1500, press_ms: null, rack_ms: 6100 });
  });
  it('sends the saved bar path on every bench, with or without Press!, as [t, y, confidence]', () => {
    for (const ct of [{ loaded: 0, start: 1500, rack: 6100 }, { loaded: 0, start: 1500, press: 3400, rack: 6100 }]) {
      const b = benchBlock(ct, { path: BOUNCE })!;
      expect(b.path).toHaveLength(BOUNCE.length);
      expect(b.path![45]).toEqual([BOUNCE[45][0], BOUNCE[45][2], 0.9]);
    }
  });
  it('sends no path when there is none saved', () => {
    expect(benchBlock({ loaded: 0, start: 1500, press: 3400, rack: 6100 }, { path: [] })).not.toHaveProperty('path');
    expect(benchBlock({ loaded: 0, start: 1500, press: 3400, rack: 6100 }, null)).not.toHaveProperty('path');
  });
  it('has no Rack! when the phone gave none', () => {
    expect(benchBlock({ loaded: 0, start: 1500, press: 4200 })).toEqual({ start_ms: 1500, press_ms: 4200, rack_ms: null });
  });
});

// a touch-and-go rep at 15 a second: down from 0.30 to 0.60 by 3.0 s, straight back up, racked at 6.1 s
const BOUNCE: BarPoint[] = Array.from({ length: 100 }, (_, i) => {
  const t = Math.round(i * 1000 / 15);
  const y = t <= 1500 ? 0.3 : t <= 3000 ? 0.3 + 0.3 * (t - 1500) / 1500 : Math.max(0.3, 0.6 - 0.3 * (t - 3000) / 1500);
  return [t, 0.5, +y.toFixed(4), 0.9];
});

describe('commandList on a lost track', () => {
  it('burns in "Press!" for press_late and skips the word in press_late_why', () => {
    expect(commandList({ loaded: 0, start: 1500, press_late_why: 'lost', press_late: 5000, rack: 8000 } as never))
      .toEqual([[0, 'Bar is loaded.'], [1500, 'Start!'], [5000, 'Press!'], [8000, 'Rack!']]);
  });
});
