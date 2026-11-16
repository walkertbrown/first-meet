// The Barbell bench on the stage (plan 3.4b, look 5.14c): the grey frame, her tap, the bar mark's size, and her
// clip's path and "Press!" tick.
import { describe, expect, it } from 'vitest';
import { frameToStage, lumaOf, markSide, pathPieces, tapToFrame, tickAt } from '../../web/lib/stage/bar-marks';
import type { BarPathPoint } from '../../web/lib/judge/bar-stage';

const box = { left: 100, top: 50, width: 400, height: 300 };
const p = (t: number, x: number, y: number, lost = false): BarPathPoint => ({ t, x, y, lost });

describe('the grey frame', () => {
  it('reads luma with the integer BT.601 weights, as the worker does', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 0]);
    expect([...lumaOf(rgba)]).toEqual([255, 0, 76, 149, 28, (77 * 10 + 150 * 20 + 29 * 30) >> 8]);
  });
});

describe('her tap (look 5.14c: the whole camera view is the target)', () => {
  it('is a fraction of the frame; the footage on screen is mirrored, the frame is not', () => {
    expect(tapToFrame(box, 200, 125, false)).toEqual({ x: 0.25, y: 0.25 });
    expect(tapToFrame(box, 200, 125, true)).toEqual({ x: 0.75, y: 0.25 });
  });
  it('a tap past the footage clamps to its edge', () => {
    expect(tapToFrame(box, 20, 900, false)).toEqual({ x: 0, y: 1 });
    expect(tapToFrame(box, 900, 0, true)).toEqual({ x: 0, y: 0 });
  });
  it('the frame point goes back to the same place on the stage', () => {
    for (const m of [false, true]) {
      const f = tapToFrame(box, 380, 260, m);
      const s = frameToStage(box, f.x, f.y, m);
      expect(s.x).toBeCloseTo(380);
      expect(s.y).toBeCloseTo(260);
    }
  });
});

describe('the bar mark', () => {
  it("is the template's size plus 12 px a side, never under 44 px", () => {
    expect(markSide(390, 0.08)).toBe(Math.round(0.08 * 390) + 24);
    expect(markSide(200, 0.04)).toBe(44);
  });
});

describe('her clip: the path breaks where it was lost, and the "Press!" tick', () => {
  const path = [p(0, 0.5, 0.3), p(40, 0.5, 0.35), p(80, 0.5, 0.4, true), p(120, 0.5, 0.45, true), p(160, 0.52, 0.5), p(200, 0.52, 0.45)];
  it('draws nothing for lost frames: two pieces', () => {
    expect(pathPieces(path)).toEqual([[{ x: 0.5, y: 0.3 }, { x: 0.5, y: 0.35 }], [{ x: 0.52, y: 0.5 }, { x: 0.52, y: 0.45 }]]);
    expect(pathPieces([])).toEqual([]);
    expect(pathPieces([p(0, 0.1, 0.1, true)])).toEqual([]);
  });
  it('the tick sits on the path at its time', () => {
    expect(tickAt(path, 170)).toEqual({ x: 0.52, y: 0.5 });
    expect(tickAt(path, 40)).toEqual({ x: 0.5, y: 0.35 });
  });
  it('a "Press!" in a lost stretch (press_late) sits on the last point the plate was seen', () => {
    expect(tickAt(path, 130)).toEqual({ x: 0.5, y: 0.35 });
  });
  it('no seen point before it: no tick', () => {
    expect(tickAt([p(10, 0.5, 0.5, true), p(50, 0.5, 0.5)], 20)).toBeNull();
    expect(tickAt(path, -1)).toBeNull();
  });
});
