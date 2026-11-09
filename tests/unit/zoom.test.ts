// The Workflow's two passes (plan 2.3) give the same calls as every frame at 15 a second.
// Simulated on the saved Chromium points: pass 1 keeps every 3rd frame (5 a second), the
// one judge names the windows, pass 2 adds the 15-a-second frames inside them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIPS_DIR, EXPECTED, checkClip } from '../clips/check';
import { ZOOM_MS, splitAt, zoomWindows, type Frame, type RepResult } from '../../web/lib/judge';

type Raw = { w: number; h: number; duration: number; frames: Frame[] };
const load = (name: string): Raw => JSON.parse(readFileSync(join(CLIPS_DIR, 'poses', `${name}.json`), 'utf8'));

/** What the worker sends: the 5 fps frames, plus the 15 fps frames the judge asked for. */
export function twoPass(raw: Raw, lift: 'squat' | 'deadlift') {
  const first = raw.frames.filter(f => Math.round(f.t * 15 / 1000) % 3 === 0);
  const zoom = zoomWindows(first, raw, lift);
  const inZoom = (t: number) => zoom.windows.some(([a, b]) => t >= a && t <= b);
  const frames = raw.frames.filter(f => Math.round(f.t * 15 / 1000) % 3 === 0 || inZoom(f.t));
  return { zoom, first, frames };
}

describe('two passes give the calls of every frame', () => {
  for (const [name, e] of EXPECTED) {
    it(name, () => {
      const raw = load(name);
      const { zoom, frames } = twoPass(raw, e.lift);
      checkClip(expect, { ...raw, frames }, e);
      expect(frames.length, 'fewer frames than 15 a second').toBeLessThan(raw.frames.length);
      for (const [a, b] of zoom.windows) expect(b, 'a window runs forward').toBeGreaterThan(a);
    });
  }
});

describe('where the second pass splits', () => {
  const rep = (startMs: number, judgedFrameMs: number, endMs: number): RepResult => ({ call: { light: 'white' }, startMs, judgedFrameMs, endMs });
  it('splits at the rep boundary nearest the middle', () => {
    const reps = [rep(1000, 2000, 3000), rep(4000, 5000, 6000), rep(7000, 8000, 9000)];
    const w: [number, number][] = [[300, 9700]];
    expect(splitAt(w, reps, 500)).toBe(3500);
  });
  it('splits a one-rep clip halfway from the start command to the bottom', () => {
    expect(splitAt([[0, 6000]], [rep(3000, 4400, 5200)], 1000)).toBe(2700);
  });
  it('never splits within 0.7 s of a call', () => {
    const s = splitAt([[0, 6000]], [rep(3000, 4400, 5200)], 3800);
    expect(s === null || Math.abs(s - 4400) >= ZOOM_MS).toBe(true);
    expect(s).toBeNull();
  });
});
