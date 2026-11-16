// The server's bench measures (plan 3.4b, "The lights"): the pause before the phone's "Press!",
// "Press! while sinking" and `shadow_lights` by item 70's rules, from the server's plate path.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BarCaller, checkCommandTimes, measureBar, plateTap, shadowLights, type BarPoint } from '../../web/lib/judge';

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
