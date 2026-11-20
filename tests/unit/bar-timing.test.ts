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

  it('the times are 0.4 s before Start! and 1.5 s after it, and 8% from the tap before it (shared/rules.json)', () => {
    expect(BAR_RULES.freezeBeforeMs).toBe(400);
    expect(BAR_RULES.freezeAfterMs).toBe(1500);
    expect(BAR_RULES.freezeNearTapPct).toBe(8);
  });

  // The Playner's ruling (Nov 20, 9:23 AM): before Start!, a stuck stretch counts only within 8% of her tap, measured
  // as leftRack is (x on the frame's height). After Start! it counts anywhere: the lifted case above holds 8% above
  // the tap, at the line, and goes stuck at 1.5 s.
  for (const [dx, dy, stuck] of [[0, 0.075, true], [0.075 * 160 / 284, 0, true], [0, 0.085, false], [0.085 * 160 / 284, 0.0001, false]] as const) {
    it(`before Start!: a still bar ${(Math.hypot(dx * 284 / 160, dy) * 100).toFixed(1)}% from the tap ${stuck ? 'is' : 'is never'} stuck`, () => {
      const c = new BarCaller({ x: 0.5, y: 0.3 }, DIMS, BAR_RULES, false);
      for (let k = 0; k * 33.37 < 3000 && c.state === 'waiting'; k++) c.feed(Math.round(k * 33.37), 0.5 + dx, 0.3 - dy, 1);
      expect(c.frozeAt.length > 0).toBe(stuck);
      if (stuck) expect(c.lostBeforeStart).not.toBeNull();
    });
  }

  // Item 112 (3.4b, "The void has three causes"): the caller says which, for the void's post, its row and its sheet
  describe('the void says its cause (item 112)', () => {
    const run = (y: (k: number) => number, score: (k: number) => number) => {
      const c = new BarCaller({ x: 0.5, y: 0.3 }, DIMS, BAR_RULES, false);
      for (let k = 0; k * 33.37 < 7000; k++) {
        const cmd = c.feed(Math.round(k * 33.37), 0.5, y(k), score(k));
        if (cmd?.void) return cmd;
      }
      return null;
    };
    it('no_start_5s: off the hooks 5 s, never still enough for Start!', () => {
      // wobbling 3% of the frame every 0.6 s (her arms shaking), at a good score
      const v = run(k => 0.25 + 0.03 * Math.sin((k * 33.37 * 2 * Math.PI) / 600), () => 0.9);
      expect(v).toMatchObject({ cmd: 'rack', void: true, voidWhy: 'no_start_5s' });
      expect(v!.t).toBeGreaterThanOrEqual(BAR_RULES.voidMs);
    });
    it('stuck: still to 1 px at 0.99 or more, near her tap', () => {
      expect(run(() => 0.3, () => 1)).toMatchObject({ void: true, voidWhy: 'stuck' });
    });
    it('low_score: under the line for 1 s off the hooks, on its own key (3.4b; the Playner, 9:39 AM)', () => {
      expect(BAR_RULES.lowScoreBeforeMs).toBe(1000);
      const low = (rules = BAR_RULES, gapEnd = Infinity) => {
        const c = new BarCaller({ x: 0.5, y: 0.3 }, DIMS, rules, false);
        for (let k = 0; k * 33.37 < 7000; k++) {
          const t = Math.round(k * 33.37), cmd = c.feed(t, 0.5, 0.25 + 0.03 * Math.sin((t * 2 * Math.PI) / 600), k < 10 || k >= gapEnd ? 0.9 : 0.2);
          if (cmd?.void) return cmd;
        }
        return null;
      };
      const v = low();
      expect(v).toMatchObject({ void: true, voidWhy: 'low_score' });
      const from = Math.round(10 * 33.37);
      expect(v!.t - from).toBeGreaterThanOrEqual(1000 - 34);
      expect(v!.t - from).toBeLessThanOrEqual(1000 + 34);
      // a 0.6 s block (someone walking past) never voids; the 5 s rule ends it instead
      expect(low(BAR_RULES, 10 + 18)).toMatchObject({ void: true, voidWhy: 'no_start_5s' });
      // the stuck window moving never moves it
      expect(low({ ...BAR_RULES, freezeMs: 2000, freezeBeforeMs: 2000 })!.t).toBe(v!.t);
    });
  });
});
