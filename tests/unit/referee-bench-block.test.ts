// The bench's pause frames (3.4d step 1): framesJob's "Start!", "Press!" and "Rack!" for make_frames.
// A late Press! after a lost track (3.4b) is `press_late`, next to `press_late_why: "lost"`, a word, not a time.
import { describe, expect, it } from 'vitest';
import { benchBlock, commandList } from '@/lib/referee/bot';

describe('benchBlock', () => {
  it('takes an on-time Press!', () => {
    expect(benchBlock({ loaded: 0, start: 1500, press: 4200, rack: 6100 })).toEqual({ start_ms: 1500, press_ms: 4200, rack_ms: 6100 });
  });
  it('takes a late Press!, whatever order the keys come in', () => {
    const want = { start_ms: 1500, press_ms: 5000, rack_ms: 8000 };
    expect(benchBlock({ loaded: 0, start: 1500, press_late_why: 'lost', press_late: 5000, rack: 8000 } as never)).toEqual(want);
    expect(benchBlock({ loaded: 0, start: 1500, press_late: 5000, press_late_why: 'lost', rack: 8000 } as never)).toEqual(want);
  });
  it('is null with no Start! or no Press!', () => {
    expect(benchBlock({ loaded: 0, start: 1500, rack: 6100 })).toBeNull();
    expect(benchBlock({ loaded: 0, press: 4200 })).toBeNull();
    expect(benchBlock(null)).toBeNull();
  });
  it('has no Rack! when the phone gave none', () => {
    expect(benchBlock({ loaded: 0, start: 1500, press: 4200 })).toEqual({ start_ms: 1500, press_ms: 4200, rack_ms: null });
  });
});

describe('commandList on a lost track', () => {
  it('burns in "Press!" for press_late and skips the word in press_late_why', () => {
    expect(commandList({ loaded: 0, start: 1500, press_late_why: 'lost', press_late: 5000, rack: 8000 } as never))
      .toEqual([[0, 'Bar is loaded.'], [1500, 'Start!'], [5000, 'Press!'], [8000, 'Rack!']]);
  });
});
