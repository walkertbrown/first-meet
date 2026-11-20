// The server's bench measures (plan 3.4b, "The lights"): the pause before the phone's "Press!",
// "Press! while sinking" and `shadow_lights` by item 70's rules, from the server's plate path.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BAR_RULES, BarCaller, checkCommandTimes, markStuck, measureBar, plateTap, shadowLights, stuckStretches, type BarPoint } from '../../web/lib/judge';

const DIMS = { w: 284, h: 160 };
const TAP = { x: 0.5, y: 0.3, size: 0.08 };
const STEP = 1000 / 15;

/** A plate path at 15 fps from a y(t) curve, x still, a perfect match unless `lost` says otherwise. */
function path(y: (t: number) => number, until = 8000, lost: (t: number) => boolean = () => false): BarPoint[] {
  const out: BarPoint[] = [];
  for (let i = 0; i * STEP <= until; i++) {
    const t = Math.round(i * STEP);
    // a little noise so the stuck-track rule never reads it as stuck
    out.push([t, 0.5 + (i % 3 - 1) * 0.004, y(t) + (i % 2 ? 0.0005 : -0.0005), lost(t) ? 0.1 : 0.9]);
  }
  return out;
}

/** Linear between [t, y] knots. */
const knots = (k: [number, number][]) => (t: number) => {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (t <= k[i][0]) {
    const [t0, y0] = k[i - 1], [t1, y1] = k[i];
    return y0 + (y1 - y0) * (t - t0) / (t1 - t0);
  }
  return k[k.length - 1][1];
};

// Start! at 2.0 s with the bar at 0.30; down to 0.45 by 3.5 s; still to 4.5 s; back up by 5.5 s.
const GOOD = knots([[0, 0.3], [2000, 0.3], [3500, 0.45], [4500, 0.45], [5500, 0.3]]);
const CT = { loaded: 0, start: 2000, press: 4300, rack: 6200, plate_tap: TAP } as unknown as Record<string, number>;
const ct = (o: Record<string, unknown>) => ({ loaded: 0, start: 2000, rack: 6200, plate_tap: TAP, ...o }) as unknown as Record<string, number>;

describe("the bench's command_times extras", () => {
  it('plate_tap and press_late_why are not times, and a broken one is a close call', () => {
    expect(checkCommandTimes(CT, 'bench', 8000)).toBeNull();
    expect(plateTap(CT)).toEqual(TAP);
    expect(checkCommandTimes(ct({ press_late: 4300, press_late_why: 'lost' }), 'bench', 8000)).toBeNull();
    expect(checkCommandTimes(ct({ press: 4300, plate_tap: { x: 2, y: 0.3, size: 0.08 } }), 'bench', 8000)).toBe('not_a_number');
    expect(checkCommandTimes(ct({ press: 4300, plate_tap: 'here' }), 'bench', 8000)).toBe('not_a_number');
    // press_late_why only with a press_late, and only still or lost
    expect(checkCommandTimes(ct({ press: 4300, press_late_why: 'still' }), 'bench', 8000)).toBe('not_a_number');
    expect(checkCommandTimes(ct({ press_late: 4300, press_late_why: 'maybe' }), 'bench', 8000)).toBe('not_a_number');
    // and the times are still checked
    expect(checkCommandTimes(ct({ press: 9000 }), 'bench', 8000)).toBe('outside_clip');
  });
  it("plate_tap's t is the tap's ms in the recording: kept, checked inside the clip, and optional (item 110)", () => {
    const at = (t: unknown) => ct({ press: 4300, plate_tap: { ...TAP, t } });
    expect(plateTap(at(1500))).toEqual({ ...TAP, t: 1500 });
    expect(plateTap(at(0))).toEqual({ ...TAP, t: 0 });
    expect(checkCommandTimes(at(1500), 'bench', 8000)).toBeNull();
    expect(checkCommandTimes(at(8000), 'bench', 8000)).toBeNull();
    expect(checkCommandTimes(at(8001), 'bench', 8000)).toBe('outside_clip');
    for (const bad of [-1, 'soon', null, Number.NaN]) expect(checkCommandTimes(at(bad), 'bench', 8000), String(bad)).toBe('not_a_number');
    // an old phone's has no t: the server's tracker starts at the clip's first frame
    expect(plateTap(CT)).not.toHaveProperty('t');
  });
});

describe('measureBar', () => {
  it('a paused rep, pressed on the stop and locked out: white, with the pause', () => {
    const m = measureBar(path(GOOD), CT, DIMS);
    expect(m.shadow).toEqual({ light: 'white', reason: null });
    expect(shadowLights(m.shadow)).toEqual(['white', 'white', 'white']);
    // still from 3.5 s (within 5% of the 0.15 travel of the bottom from about 3.45 s) to Press! at 4.3 s
    expect(m.pause_s!).toBeGreaterThan(0.75);
    expect(m.pause_s!).toBeLessThan(0.95);
    expect(m.press_while_sinking).toBe(false);
    expect(m.sink!).toBeLessThan(0.002);
    expect(m.lost_share).toBe(0);
    expect(m.lost_after_start).toBe(false);
  });

  it('"Press!" while the bar is still going down: press_while_sinking, and the sink', () => {
    const m = measureBar(path(GOOD), ct({ press: 2900 }), DIMS);
    expect(m.press_while_sinking).toBe(true);
    // at 2.9 s the bar is at 0.39; it goes on to 0.45
    expect(m.sink!).toBeGreaterThan(0.05);
    expect(m.pause_s!).toBeLessThan(0.1);
  });

  it('she rose before "Press!": red no_pause', () => {
    const y = knots([[0, 0.3], [2000, 0.3], [3500, 0.45], [4000, 0.45], [4300, 0.42], [5300, 0.3]]);
    const m = measureBar(path(y), CT, DIMS);
    expect(m.shadow).toEqual({ light: 'red', reason: 'no_pause' });
    expect(shadowLights(m.shadow)).toEqual(['red', 'red', 'red']);
  });

  it("the bar never gets back up: red no_lockout", () => {
    const y = knots([[0, 0.3], [2000, 0.3], [3500, 0.45], [4500, 0.45], [5500, 0.38]]);
    expect(measureBar(path(y), CT, DIMS).shadow).toEqual({ light: 'red', reason: 'no_lockout' });
  });

  it('a late "Press!" is a close call, never a red; lost after Start! is counted', () => {
    const m = measureBar(path(GOOD), ct({ press_late: 4300, press_late_why: 'lost' }), DIMS);
    expect(m.shadow).toEqual({ light: 'close', reason: 'visibility' });
    expect(shadowLights(m.shadow)).toBeNull();
    expect(m.lost_after_start).toBe(true);
  });

  it('after a lost bar, neither the pause nor a sink is measured, even where the path came back (5.33, item 107)', () => {
    // the bar found again after the loss: measured across the gap, this Press! would read 0.0 s still and sinking
    const m = measureBar(path(GOOD, 8000, t => t > 2300 && t < 2800), ct({ press_late: 2900, press_late_why: 'lost' }), DIMS);
    expect(m.pause_s).toBeNull();
    expect(m.sink).toBeNull();
    expect(m.press_while_sinking).toBe(false);
    // keyed on press_late_why itself: the server's tracker may never lose the bar the phone lost, so an unbroken path
    // sends neither either (NerdCider, Nov 15, 11:23 PM)
    const whole = measureBar(path(GOOD), ct({ press_late: 2900, press_late_why: 'lost' }), DIMS);
    expect([whole.pause_s, whole.sink, whole.press_while_sinking]).toEqual([null, null, false]);
    // the same times as an on-time Press! do measure
    expect(measureBar(path(GOOD), ct({ press: 2900 }), DIMS).press_while_sinking).toBe(true);
  });

  it('back up with no "Press!": close short_pause; no Press! and no rep: close visibility', () => {
    const shortRep = knots([[0, 0.3], [2000, 0.3], [3500, 0.45], [4500, 0.3]]);
    expect(measureBar(path(shortRep), ct({}), DIMS).shadow).toEqual({ light: 'close', reason: 'short_pause' });
    expect(measureBar(path(() => 0.3), ct({}), DIMS).shadow).toEqual({ light: 'close', reason: 'visibility' });
  });

  it('the plate lost for more than 20% of the window, or at the bottom: close visibility', () => {
    const long = measureBar(path(GOOD, 8000, t => t > 2500 && t < 3600), CT, DIMS);
    expect(long.lost_share!).toBeGreaterThan(0.2);
    expect(long.shadow).toEqual({ light: 'close', reason: 'visibility' });
    const bottom = measureBar(path(GOOD, 8000, t => t > 4000 && t < 4600), CT, DIMS);
    expect(bottom.lost_share!).toBeLessThan(0.2);
    expect(bottom.shadow).toEqual({ light: 'close', reason: 'visibility' });
  });

  // The meet traces: lifters who heard no commands. The phone's commands are the caller's on the same trace;
  // tests/bench-commands/data/eyetimes.json has when each really stopped and rose.
  const trace = (id: string) => JSON.parse(readFileSync(join(__dirname, `../bench-commands/data/traces/${id}.json`), 'utf8')) as
    { w: number; h: number; racked: boolean; mark: { x: number; y: number }; pts: BarPoint[] };
  const phoneOn = (tr: ReturnType<typeof trace>) => {
    const c = new BarCaller(tr.mark, tr, undefined, tr.racked);
    const out: Record<string, unknown> = { loaded: tr.pts[0][0], plate_tap: { ...tr.mark, size: 0.08 } };
    for (const [t, x, y, s] of tr.pts) { const r = c.feed(t, x, y, s); if (r) out[r.cmd === 'press' && r.late ? 'press_late' : r.cmd] = t; }
    return out as Record<string, number>;
  };

  it("real traces: a white on KrDo (Press! before she rose), a red no_pause on Ecs1 (she rose first)", () => {
    // KrDo: stopped 56.80 s, rose 57.87 s by eye; Press! at 57.47 s
    const kr = trace('KrDo'), krCt = phoneOn(kr);
    expect(krCt.press).toBeLessThan(57870);
    const k = measureBar(kr.pts, krCt, kr);
    expect(k.shadow).toEqual({ light: 'white', reason: null });
    expect(k.press_while_sinking).toBe(false);
    expect(k.pause_s!).toBeGreaterThan(0.6);
    expect(k.pause_s!).toBeLessThan(1.1);
    // Ecs1: rose 27.20 s by eye; Press! at 27.30 s. The server's caller, racked, gives the same three commands.
    const ec = trace('Ecs1'), ecCt = phoneOn(ec);
    expect(ecCt.press).toBeGreaterThan(27200);
    const e = measureBar(ec.pts, ecCt, ec);
    expect(e.shadow).toEqual({ light: 'red', reason: 'no_pause' });
    expect(e.server_commands.map(x => [x.cmd, x.t])).toEqual([['start', ecCt.start], ['press', ecCt.press], ['rack', ecCt.rack]]);
  });
});

// 3.4b, item 108: a track that sticks at a lower score, found after the lift. Still to 0.002 in x and y for 0.8 s
// or more, counted on frames between Start! and Rack! only (reading (a)), the length in frames × the frame time.
describe('the stuck-track guard (item 108)', () => {
  /** GOOD's path with the bar frozen dead still (the tracker stuck) over [a, b] ms. */
  const frozen = (a: number, b: number, y = GOOD): BarPoint[] =>
    path(y).map(p => (p[0] >= a && p[0] <= b ? [p[0], 0.5, 0.42, 0.6] : p));
  const frames = (pts: BarPoint[], [a, b]: [number, number]) => pts.filter(p => p[0] >= a && p[0] <= b).length;

  it('12 frames at 15 fps is 0.8 s and caught; 11 is not; a moving bar never is', () => {
    expect(BAR_RULES.stuckMs).toBe(800);
    expect(BAR_RULES.stuckStill).toBe(0.002);
    // 12 frames is 733 ms last-to-first on rounded ms: by frames × frame time it is 800 ms
    const p12 = frozen(3000, 3000 + 11 * STEP + 1);
    const s12 = stuckStretches(p12, CT);
    expect(s12).toHaveLength(1);
    expect(frames(p12, s12[0])).toBe(12);
    // an 11-frame still inside the window isn't marked
    const p11 = frozen(3000, 3000 + 10 * STEP + 1);
    expect(p11.filter(q => q[1] === 0.5 && q[2] === 0.42)).toHaveLength(11);
    expect(stuckStretches(p11, CT)).toEqual([]);
    expect(stuckStretches(path(GOOD), CT)).toEqual([]);
    // still, but only within 0.003, two frames at each spot: not stuck
    const wobble = path(GOOD).map((p, i) => (p[0] >= 3000 && p[0] <= 4500 ? [p[0], 0.5 + (Math.floor(i / 2) % 2) * 0.003, 0.42, 0.9] : p)) as BarPoint[];
    expect(stuckStretches(wobble, CT)).toEqual([]);
  });

  // Item 114's hole on the fallback (The Playner, Nov 20, 10:24 AM): a frozen track whose points are exactly
  // identical for 1 s is stuck on both cadences. On the refresh tick the grouping makes it one long "camera frame",
  // but the stretch is counted in points x the path's frame gap, so it's still 1 s.
  it('a frozen track exactly identical for 1 s is stuck, one point per camera frame and on the refresh tick', () => {
    for (const fps of [30, 20, 15]) {
      const gap = 1000 / fps;
      const cam: BarPoint[] = [];
      for (let k = 0; k * gap <= 6000; k++) {
        const t = k * gap, still = t >= 3000 && t < 4000;
        cam.push([t, still ? 0.5 : 0.3 + k * 0.004, still ? 0.42 : 0.3 + k * 0.004, 0.6]);
      }
      const refresh = cam.flatMap((q, k) => {
        const next = cam[k + 1]?.[0] ?? q[0] + gap, out: BarPoint[] = [];
        for (let t = q[0]; t < next - 1e-6; t += 1000 / 60) out.push([t, q[1], q[2], q[3]]);
        return out;
      });
      for (const [how, p] of [['frame', cam], ['refresh', refresh]] as const) {
        const st = stuckStretches(p, CT);
        expect(st, `${fps} fps, ${how}`).toHaveLength(1);
        expect(st[0][0], `${fps} fps, ${how}`).toBeCloseTo(3000, 0);
        expect(st[0][1], `${fps} fps, ${how}`).toBeGreaterThan(3900);
      }
    }
  });

  // Item 113 (3.4b, "One off frame doesn't end a stretch"; The Playner, Nov 20, 9:58 AM)
  describe('one off frame does not end a stretch (item 113)', () => {
    const A = 3000, N = 7; // two 7-frame halves at 15 fps: each 0.47 s, under 0.8 s alone
    const blip = (offs: number[], dy = 0.05) => {
      const p = frozen(A, A + (2 * N + offs.length) * STEP);
      const first = p.findIndex(q => q[0] >= A);
      for (const k of offs) p[first + N + k] = [p[first + N + k][0], 0.5, 0.42 + dy, 0.6];
      return { p, off: offs.map(k => p[first + N + k][0]) };
    };
    it('one frame outside the box, with the frames either side back in it, is part of the stretch and marked', () => {
      for (const dy of [0.05, -0.05]) {
        const { p, off } = blip([0], dy);
        const s = stuckStretches(p, CT);
        expect(s).toHaveLength(1);
        expect(s[0][0]).toBeLessThan(off[0]);
        expect(s[0][1]).toBeGreaterThan(off[0]);
        const g = markStuck(p, CT).path;
        expect(g.find(q => q[0] === off[0])![3]).toBe(0);
      }
    });
    it('two off frames in a row end it: each half alone is under 0.8 s, so nothing is marked', () => {
      expect(stuckStretches(blip([0, 1]).p, CT)).toEqual([]);
    });
    it("the off frame's own x and y never widen the box", () => {
      // the frame after the off one is 0.0015 from the stretch and 0.0485 from the off frame: it's in the stretch
      const { p } = blip([0]);
      const first = p.findIndex(q => q[0] >= A);
      p[first + N + 1] = [p[first + N + 1][0], 0.5, 0.4215, 0.6];
      expect(stuckStretches(p, CT)).toHaveLength(1);
    });
    it('at the live tick, one camera frame fed 2–4 times is still one off frame; two different ones end it (NerdCider, 10:00 AM)', () => {
      // each camera frame at every 16.7 ms tick: the off frame is a run of points with its own x and y
      const fed = (p: BarPoint[], n: number) => p.flatMap(q => Array.from({ length: n }, (_, k) => [q[0] + k * (STEP / n), q[1], q[2], q[3]] as BarPoint));
      for (const n of [2, 3, 4]) {
        expect(stuckStretches(fed(blip([0]).p, n), CT)).toHaveLength(1);
        expect(stuckStretches(fed(blip([0, 1]).p, n), CT)).toEqual([]);
      }
    });
    it("a bar 0.003 apart on every other frame isn't stuck: it moves every frame, so nothing is carried", () => {
      const flip = path(GOOD).map((q, i) => (q[0] >= 3000 && q[0] <= 4500 ? [q[0], 0.5 + (i % 2) * 0.003, 0.42, 0.9] : q)) as BarPoint[];
      expect(stuckStretches(flip, CT)).toEqual([]);
    });
    // 3.4b, "Only on a frozen track's motion" (The Playner, Nov 20, 10:13 AM): the carry holds only when the median
    // step between camera frames is under stuckCarryStep
    describe("only on a frozen track's motion", () => {
      const eps = 1e-6;
      /** a still bar at 15 fps over [A, A + 15 frames], each frame `step` from the last (alternating, so it stays in the box), one off frame mid-way */
      const jitter = (step: number) => {
        const p = path(GOOD);
        const first = p.findIndex(q => q[0] >= A);
        for (let k = 0; k < 2 * N + 1; k++) p[first + k] = [p[first + k][0], 0.5 + (k % 2) * step, 0.42, 0.6];
        p[first + N] = [p[first + N][0], 0.5, 0.47, 0.6];
        return p;
      };
      it('is 0.0002 of the frame', () => expect(BAR_RULES.stuckCarryStep).toBe(0.0002));
      it('a track that moves 0.0001 a frame (a frozen tracker) carries the off frame: one stretch', () => {
        expect(stuckStretches(jitter(0.0001), CT)).toHaveLength(1);
      });
      it("a bar that moves 0.0007 a frame (KrDo's real still bar) doesn't: two halves under 0.8 s, nothing marked", () => {
        expect(stuckStretches(jitter(0.0007), CT)).toEqual([]);
      });
      it('fed 2-4 times at the live tick, the repeats of one camera frame count once', () => {
        const fed = (p: BarPoint[], n: number) => p.flatMap(q => Array.from({ length: n }, (_, k) => [q[0] + k * (STEP / n), q[1], q[2], q[3]] as BarPoint));
        for (const n of [2, 3, 4]) {
          expect(stuckStretches(fed(jitter(0.0001), n), CT)).toHaveLength(1);
          expect(stuckStretches(fed(jitter(0.0007), n), CT)).toEqual([]);
        }
      });
      it("taken up to the off frame: a track frozen, then moving, carries into the frozen part only (NerdCider, 10:15 AM)", () => {
        // 0.0001 a frame for 7 frames, the off frame, then 0.0007 a frame for 7: the median up to the off frame is the
        // frozen part's, so it's carried; a second off frame in the moving part isn't (its median up to it is 0.0007's
        // as often as not, and the stretch ends there)
        const p = path(GOOD);
        const first = p.findIndex(q => q[0] >= A);
        for (let k = 0; k < 4 * N; k++) p[first + k] = [p[first + k][0], 0.5 + (k % 2) * (k < N ? 0.0001 : 0.0007), 0.42, 0.6];
        p[first + N] = [p[first + N][0], 0.5, 0.47, 0.6];
        p[first + 3 * N] = [p[first + 3 * N][0], 0.5, 0.47, 0.6];
        const s = stuckStretches(p, CT);
        expect(s).toHaveLength(1);
        expect(s[0][0]).toBe(p[first][0]);
        expect(s[0][1]).toBe(p[first + 3 * N - 1][0]);
      });
      it("tick repeats that aren't exact (nudged 1e-6) never carry a real bar's off frame (NerdCider, 10:15 AM)", () => {
        const nudged = (p: BarPoint[], n: number) => p.flatMap(q => Array.from({ length: n }, (_, k) => [q[0] + k * (STEP / n), q[1] + k * 1e-6, q[2], q[3]] as BarPoint));
        for (const n of [2, 3, 4]) expect(stuckStretches(nudged(jitter(0.0007), n), CT)).toEqual([]);
      });
      it('a stretch at exactly 800 ms is stuck at every cadence: 0.5 ms under stuckMs, so rounding never decides it', () => {
        // 24 frames at 30 fps, 16 at 20, 12 at 15, each also at the live tick and fed 3 times
        for (const fps of [30, 20, 15]) {
          const gap = 1000 / fps, n = Math.round(0.8 * fps);
          const cam: BarPoint[] = [];
          for (let k = 0; k * gap <= 6000; k++) {
            const t = k * gap;
            const inStretch = t >= 3000 - eps && k < Math.round(3000 / gap) + n;
            cam.push([t, inStretch ? 0.5 : 0.3 + k * 0.004, inStretch ? 0.42 : 0.3 + k * 0.004, 0.6]);
          }
          for (const per of [1, 2, 3, 4]) {
            const p = cam.flatMap(q => Array.from({ length: per }, (_, k) => [q[0] + k * (gap / per), q[1], q[2], q[3]] as BarPoint));
            expect(stuckStretches(p, CT), `${fps} fps, each frame ${per}x`).toHaveLength(1);
          }
        }
      });
      it("with no step to measure, nothing is carried: an off frame as a stretch's second frame (VibeSearch, 10:25 AM)", () => {
        // a real bar moving 0.0007 a frame: one frame, the off frame, then 10 frames still (0.67 s at 15 fps). Carried,
        // it would be 12 frames, 0.8 s, and stuck
        const fed = (p: BarPoint[], n: number) => p.flatMap(q => Array.from({ length: n }, (_, k) => [q[0] + k * (STEP / n), q[1], q[2], q[3]] as BarPoint));
        const p = path(GOOD);
        const first = p.findIndex(q => q[0] >= A);
        for (let k = 0; k < 12; k++) p[first + k] = [p[first + k][0], 0.5 + (k % 2) * 0.0007, 0.42, 0.6];
        p[first + 1] = [p[first + 1][0], 0.5, 0.47, 0.6];
        for (const n of [1, 2, 3, 4]) expect(stuckStretches(fed(p, n), CT), `fed ${n}x`).toEqual([]);
      });
      it('a stretch stuck without the carry is still stuck, however it moves', () => {
        const p = path(GOOD);
        const first = p.findIndex(q => q[0] >= A);
        for (let k = 0; k < 14; k++) p[first + k] = [p[first + k][0], 0.5 + (k % 2) * 0.0007, 0.42, 0.6];
        expect(stuckStretches(p, CT)).toHaveLength(1);
      });
    });
  });

  it('whatever the score: a stuck stretch at a perfect match is still caught', () => {
    const p = path(GOOD).map(q => (q[0] >= 3000 && q[0] <= 4400 ? [q[0], 0.5, 0.42, 1] : q)) as BarPoint[];
    expect(stuckStretches(p, CT)).toHaveLength(1);
  });

  it('only frames inside Start!–Rack! count: a still bar on the hooks, or across Start!, counts only its part inside', () => {
    // dead still from 0 to 2.6 s: 1.6 s of it before Start! (2.0 s), 0.6 s after
    const hooks = path(GOOD).map(q => (q[0] <= 2600 ? [q[0], 0.5, 0.3, 0.9] : q)) as BarPoint[];
    expect(stuckStretches(hooks, CT)).toEqual([]);
    // with Start! at 1.0 s, 1.6 s of it is inside: caught, from Start! on
    const s = stuckStretches(hooks, ct({ start: 1000, press: 4300 }));
    expect(s).toHaveLength(1);
    expect(s[0][0]).toBeGreaterThanOrEqual(1000);
    // and after Rack! (6.2 s), or with no Start!, nothing is looked at
    const racked = path(GOOD).map(q => (q[0] >= 5800 ? [q[0], 0.5, 0.3, 0.9] : q)) as BarPoint[];
    expect(stuckStretches(racked, CT)).toEqual([]);
    expect(stuckStretches(frozen(3000, 4500), ct({ start: null }))).toEqual([]);
  });

  // Her lockout hold (The Playner, 2:27 AM): after Press! (or the lowest point), within the back-up band of Start!
  // height, it's left alone. GOOD is back at 0.30 by 5.5 s; the band is 5% of its 0.15 travel, 0.0075.
  const LONG = ct({ press: 4300, rack: 7600 });
  const held = (a: number, b: number, y: number, f = GOOD): BarPoint[] => path(f).map(q => (q[0] >= a && q[0] <= b ? [q[0], 0.5, y, 0.9] : q));
  it('her lockout hold after Press!, within the back-up band, is never marked; with no Press!, after the lowest point', () => {
    const p = held(5600, 7500, 0.3);
    expect(stuckStretches(p, LONG, { ...BAR_RULES, rackRel: -1e9 })).toHaveLength(1); // still enough to be caught
    expect(stuckStretches(p, LONG)).toEqual([]);
    expect(markStuck(p, LONG).stuck).toEqual([]);
    expect(stuckStretches(p, ct({ rack: 7600 }))).toEqual([]);
    // the same still bar starting before Press! is a stick, and caught
    expect(stuckStretches(held(4200, 5500, 0.42), LONG)).toHaveLength(1);
  });
  it('a still stretch after Press! below the back-up band, on the way up, is still marked', () => {
    // up from the bottom to 0.40 by 4.8 s, stuck there to 5.8 s, then on up to 0.30 by 6.5 s
    const up = knots([[0, 0.3], [2000, 0.3], [3500, 0.45], [4500, 0.45], [4800, 0.4], [5800, 0.4], [6500, 0.3]]);
    const p = held(4800, 5800, 0.4, up);
    const st = stuckStretches(p, LONG);
    expect(st).toHaveLength(1);
    expect(st[0][0]).toBeGreaterThan(4300);
    // just inside the band (0.3 + 0.0075) it would be a hold
    expect(stuckStretches(held(4800, 5800, 0.307, knots([[0, 0.3], [2000, 0.3], [3500, 0.45], [4500, 0.45], [4800, 0.307], [5800, 0.307], [6500, 0.3]])), LONG)).toEqual([]);
  });

  it('markStuck marks the stuck frames lost (score 0) and nothing else', () => {
    const p = frozen(3000, 4400);
    const { path: g, stuck } = markStuck(p, CT);
    expect(stuck).toHaveLength(1);
    g.forEach((q, i) => {
      const inside = q[0] >= stuck[0][0] && q[0] <= stuck[0][1];
      expect(q[3]).toBe(inside ? 0 : p[i][3]);
      expect(q.slice(0, 3)).toEqual(p[i].slice(0, 3));
    });
    const clean = path(GOOD);
    expect(markStuck(clean, CT)).toEqual({ path: clean, stuck: [] });
  });

  it('a stuck frame near the pause: pause_lost, no pause and no sink; the same path unguarded measured a wrong pause', () => {
    // stuck on the way down at 0.42 from 3.2 s to 4.4 s; Press! at 4.3 s
    const p = frozen(3200, 4400);
    const bad = measureBar(p, CT, DIMS);
    expect(bad.pause_lost).toBe(false);
    const { path: g } = markStuck(p, CT);
    const m = measureBar(g, CT, DIMS);
    expect(m.pause_lost).toBe(true);
    expect(m.pause_s).toBeNull();
    expect(m.sink).toBeNull();
    expect(m.press_while_sinking).toBe(false);
    expect(measureBar(path(GOOD), CT, DIMS).pause_lost).toBe(false);
  });

  it('a lost frame more than 0.5 s before the lowest point leaves the pause measured', () => {
    // lost from 2.3 s to 2.6 s on the way down; the lowest point is at about 3.5 s or later
    const m = measureBar(path(GOOD, 8000, t => t > 2300 && t < 2600), CT, DIMS);
    expect(m.pause_lost).toBe(false);
    expect(m.pause_s!).toBeGreaterThan(0.5);
    // lost at the bottom, before Press!: pause_lost
    expect(measureBar(path(GOOD, 8000, t => t > 3900 && t < 4100), CT, DIMS).pause_lost).toBe(true);
  });

  // The server's own plate tracks (tests/bench-commands/server.py): IA0P sticks on reps 1 and 3, z838 from rep 1's way
  // down to its end. Rep 3 of IA0P was 16 frames, 1.07 s by frames: NerdCider's edge, pinned (Nov 16, 2:20 AM). Item
  // 113 carries it through one off camera frame at 17.57 s, to 18 frames.
  const server = (id: string) => JSON.parse(readFileSync(join(__dirname, `../bench-commands/data/server/${id}.json`), 'utf8')) as BarPoint[];
  const near = (got: [number, number][], want: [number, number][]) => {
    expect(got).toHaveLength(want.length);
    got.forEach(([a, b], i) => { expect(Math.abs(a - want[i][0])).toBeLessThan(40); expect(Math.abs(b - want[i][1])).toBeLessThan(40); });
  };
  it("the server's tracks: IA0P's reps 1 and 3, z838's long stick, and none on a real 1 s pause", () => {
    const ia = server('IA0PhDBzsz0');
    const st = stuckStretches(ia, ct({ start: 6800, rack: 18880 }));
    near(st, [[8600, 9867], [16533, 17667]]); // item 113: rep 3 runs 2 frames on, through one off frame
    expect(frames(ia, st[1])).toBe(18);
    // each rep's own cut (the set), and the whole clip, agree on rep 3
    near(stuckStretches(ia, ct({ start: 14600, rack: 18880 })), [[16533, 17667]]);
    // marked lost, so the cut's pause is not measured
    const { path: g } = markStuck(ia, ct({ start: 14600, rack: 18880 }));
    expect(g.filter(p => p[0] >= 16533 && p[0] <= 17667).every(p => p[3] === 0)).toBe(true);
    near(stuckStretches(server('z838WQVSBmk'), ct({ start: 0, rack: 13900 })), [[2133, 13867]]);
    // rep 3 cut with the phone caller's own calls (the set's IA0P-r3-stuck): caught, and Press! (16.82 s) falls in it
    const cut3 = ct({ start: 15210, press: 16820, rack: 18890 });
    near(stuckStretches(ia, cut3), [[16533, 17667]]);
    expect(measureBar(markStuck(ia, cut3).path, cut3, DIMS).pause_lost).toBe(true);
    // hIuj's lost-track cut: her 1.67 s hold at arm's length for a late Rack! is left alone (NerdCider, 2:23 AM)
    const hi = server('hIuj1H1WOxM'), hiLost = ct({ start: 1035, press_late: 3535, press_late_why: 'lost', rack: 6535 });
    expect(stuckStretches(hi, hiLost)).toEqual([]);
    near(stuckStretches(hi, hiLost, { ...BAR_RULES, rackRel: -1e9 }), [[4267, 5867]]);
    // the three real pauses of 1.0 s or more (KrDo, uGCh, Nazt), the whole clip: nothing caught
    for (const id of ['KrDo', 'uGCh', 'Nazt']) {
      const tr = server(id);
      expect(stuckStretches(tr, ct({ start: tr[0][0], rack: tr.at(-1)![0] }))).toEqual([]);
    }
  });
});
