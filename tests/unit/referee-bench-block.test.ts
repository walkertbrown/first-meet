// The bench's pause frames (3.4d step 1): framesJob's "Start!", "Press!" and "Rack!" for make_frames.
// A late Press! after a lost track (3.4b) is `press_late`, next to `press_late_why: "lost"`, a word, not a time.
import { describe, expect, it } from 'vitest';
import { benchBlock, commandList } from '@/lib/referee/bot';
import { barLowestMs, type BarPoint } from '@/lib/judge/bar-measure';

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
    expect(benchBlock({ loaded: 0, start: 1500, rack: 6100 })).toEqual({ start_ms: 1500, press_ms: null, rack_ms: 6100, bar_low_ms: null });
    // the saved plate path's lowest point, for when her wrists can't be seen
    expect(near(benchBlock({ loaded: 0, start: 1500, rack: 6100 }, { path: BOUNCE, w: 1280, h: 720 })!.bar_low_ms ?? null, 3000)).toBe(true);
  });
  it('sends no bar_low_ms when there is a Press!, even with a path', () => {
    expect(benchBlock({ loaded: 0, start: 1500, press: 3400, rack: 6100 }, { path: BOUNCE, w: 1280, h: 720 })).not.toHaveProperty('bar_low_ms');
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
const near = (t: number | null, want: number) => t !== null && Math.abs(t - want) <= 70;

describe('barLowestMs (3.4d step 1, no Press! and no usable poses)', () => {
  it('is the bar path\'s lowest point between Start! and Rack!', () => {
    expect(near(barLowestMs(BOUNCE, { loaded: 0, start: 1500, rack: 6100 }, { w: 1280, h: 720 }), 3000)).toBe(true);
  });
  it('looks no further than Rack!', () => {
    const lowAfter: BarPoint[] = [...BOUNCE.filter(p => p[0] <= 6100), [6200, 0.5, 0.9, 0.9], [6267, 0.5, 0.9, 0.9], [6333, 0.5, 0.9, 0.9]];
    expect(near(barLowestMs(lowAfter, { loaded: 0, start: 1500, rack: 6100 }, { w: 1280, h: 720 }), 3000)).toBe(true);
  });
  it('is null with no Start!, no path, or a bar the tracker never saw', () => {
    expect(barLowestMs(BOUNCE, { loaded: 0, rack: 6100 }, { w: 1280, h: 720 })).toBeNull();
    expect(barLowestMs([], { loaded: 0, start: 1500, rack: 6100 }, { w: 1280, h: 720 })).toBeNull();
    expect(barLowestMs(BOUNCE.map(([t, x, y]) => [t, x, y, 0] as BarPoint), { loaded: 0, start: 1500, rack: 6100 }, { w: 1280, h: 720 })).toBeNull();
  });
});

describe('commandList on a lost track', () => {
  it('burns in "Press!" for press_late and skips the word in press_late_why', () => {
    expect(commandList({ loaded: 0, start: 1500, press_late_why: 'lost', press_late: 5000, rack: 8000 } as never))
      .toEqual([[0, 'Bar is loaded.'], [1500, 'Start!'], [5000, 'Press!'], [8000, 'Rack!']]);
  });
});
