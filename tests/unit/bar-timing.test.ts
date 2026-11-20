// Counted in time, not frames (3.4b): measureBar's median (item 110, "The smoothing is in time, not points") and the
// 0.99 stuck rule's window (item 111), so one bar on two phones, or a camera frame the live tick shows three times,
// gets the same reading.
import { describe, expect, it } from 'vitest';
import { BAR_RULES, BarCaller, SMOOTH_SLACK_MS, smooth } from '../../web/lib/judge';

const DIMS = { w: 284, h: 160 };
/** One camera frame's ms at each rate the tests use: 15, 24, 30 (the traces' 33.37 ms grid) and 60 fps. */
const GAPS = [1000 / 15, 1000 / 24, 33.37, 1000 / 60];

describe('the 100 ms time median (item 110)', () => {
  const pts = (gap: number, n: number, y: (i: number) => number, repeat = 1) =>
    Array.from({ length: n * repeat }, (_, k) => ({ t: Math.floor(k / repeat) * gap + (k % repeat) * (gap / repeat), y: y(Math.floor(k / repeat)), ok: true }));

  it('is 100 ms either side, with 5 ms slack: a point 105 ms away is in, 106 ms is not', () => {
    expect(BAR_RULES.smoothMs).toBe(100);
    expect(SMOOTH_SLACK_MS).toBe(5);
    const a = smooth([{ t: 0, y: 0, ok: true }, { t: 105, y: 1, ok: true }, { t: 210, y: 1, ok: true }]);
    expect(a[0].y).toBe(1); // both of t 0 and t 105 in its window: [0, 1], the median the upper
    const b = smooth([{ t: 0, y: 0, ok: true }, { t: 106, y: 1, ok: true }]);
    expect(b[0].y).toBe(0);
    expect(b[1].y).toBe(1);
  });

  for (const gap of GAPS) for (const repeat of [1, 3]) {
    it(`one bad camera frame is smoothed away at ${(1000 / gap).toFixed(0)} fps${repeat > 1 ? ', each frame fed 3 times' : ''}`, () => {
      const s = smooth(pts(gap, 40, i => (i === 20 ? 0.6 : 0.4), repeat));
      expect(Math.max(...s.map(p => p.y))).toBe(0.4);
    });
  }

  it("the 3-point median it replaced didn't smooth a frame fed 3 times: the window there is one camera frame", () => {
    const p = pts(1000 / 30, 40, i => (i === 20 ? 0.6 : 0.4), 3);
    const three = p.map((q, i) => [p[i - 1]?.y ?? q.y, q.y, p[i + 1]?.y ?? q.y].sort((a, b) => a - b)[1]);
    expect(Math.max(...three)).toBe(0.6);
  });

  it('a lost point never counts', () => {
    const s = smooth([{ t: 0, y: 0.4, ok: true }, { t: 33, y: 0.9, ok: false }, { t: 67, y: 0.4, ok: true }]);
    expect(s.map(p => p.y)).toEqual([0.4, 0.4]);
  });
});

describe('the stuck rule, counted in time (item 111)', () => {
  /** When the caller first reads a perfectly still bar at a score of 1.00 as stuck, from the first still point. */
  function stuckAfter(gap: number, opts: { lifted?: boolean; jitter?: boolean } = {}) {
    const c = new BarCaller({ x: 0.5, y: 0.3 }, DIMS, BAR_RULES, false);
    let t = 0, i = 0;
    const next = () => { t += gap + (opts.jitter ? ((i * 7) % 5 - 2) * 0.6 : 0); i++; return Math.round(t); };
    if (opts.lifted) {
      // off the hooks and held (1 px of wobble, so never stuck) until Start!, then frozen
      // on the hooks, then lifted out 8% of the frame in 0.5 s, then held at the top
      for (let k = 0; k * gap < 300; k++) c.feed(next(), 0.5, 0.3 + (k % 2 ? 0.004 : -0.004), 0.9);
      for (let k = 0; k * gap < 500; k++) c.feed(next(), 0.5, 0.3 - 0.08 * (k * gap) / 500, 0.9);
      for (let k = 0; c.state === 'waiting' && k * gap < 3000; k++) c.feed(next(), 0.5, 0.22 + (k % 2 ? 0.004 : -0.004), 0.9);
      expect(c.state).toBe('lifting');
    }
    const from = Math.round(t + gap);
    for (let k = 0; k * gap < 4000 && !c.frozeAt.length; k++) c.feed(next(), 0.5, opts.lifted ? 0.22 : 0.3, 1);
    return c.frozeAt.length ? c.frozeAt[0] - from : null;
  }

  for (const gap of GAPS) for (const jitter of [false, true]) {
    const at = `${(1000 / gap).toFixed(0)} fps${jitter ? ', with uneven frame times' : ''}`;
    it(`before Start!: stuck after 0.4 s, within one frame, at ${at}`, () => {
      const ms = stuckAfter(gap, { jitter });
      expect(ms).not.toBeNull();
      expect(ms!).toBeGreaterThanOrEqual(BAR_RULES.freezeBeforeMs - gap - 2);
      expect(ms!).toBeLessThanOrEqual(BAR_RULES.freezeBeforeMs + gap + 2);
    });
    it(`after Start!: stuck after 1.5 s, within one frame, at ${at}`, () => {
      const ms = stuckAfter(gap, { lifted: true, jitter });
      expect(ms).not.toBeNull();
      expect(ms!).toBeGreaterThanOrEqual(BAR_RULES.freezeAfterMs - gap - 2);
      expect(ms!).toBeLessThanOrEqual(BAR_RULES.freezeAfterMs + gap + 2);
    });
  }

  it('the times are 0.4 s before Start! and 1.5 s after it (shared/rules.json)', () => {
    expect(BAR_RULES.freezeBeforeMs).toBe(400);
    expect(BAR_RULES.freezeAfterMs).toBe(1500);
  });
});
