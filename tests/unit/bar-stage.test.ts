// The phone's bench stage (plan 3.4b, look 5.14c) on drawn frames: a plate on a textured room, moving the way
// a bench moves. The tap, the mark following it, lost on the hooks, a second tap, the commands, the void and
// `plate_tap`.
import { describe, expect, it } from 'vitest';
import { BarStage, smallWidth, type BarStageEvent } from '../../web/lib/judge/bar-stage';
import { BAR_FRAME_H, type Gray } from '../../web/lib/judge/plate-tracker';

const H = BAR_FRAME_H, W = smallWidth(1280, 720, H); // a phone on its side
const DIMS = { w: 1280, h: 720 };
const FPS = 30, DT = 1000 / FPS;

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const room = (() => { const r = rng(7); const px = new Uint8Array(W * H); for (let i = 0; i < px.length; i++) px[i] = 90 + Math.floor(r() * 40); return px; })();

/**
 * One frame with the plate at (x, y), fractions of the frame; none if `plate` is false. Like a real camera:
 * sensor noise, and a held bar that is never quite still (a pixel or so of sway at this size), so the
 * stuck-track rule (a score of 0.99 with under 1 px of movement) never takes it for a frozen track.
 */
function frame(x: number, y: number, k: number, plate = true): Gray {
  const r = rng(1000 + k);
  const px = new Uint8Array(room.length);
  for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, room[i] + Math.floor((r() - 0.5) * 16)));
  if (plate) {
    // a slow loop, 1.5 by 1 px every 2 s: under the caller's stillness limits, and never 400 ms within a pixel
    const cx = x * W + 1.5 * Math.sin(k / 9.55), cy = y * H + 1.0 * Math.cos(k / 9.55);
    for (let j = -9; j <= 9; j++) for (let i = -9; i <= 9; i++) {
      const d = Math.hypot(i, j); if (d > 7.5) continue;
      const xx = Math.round(cx + i), yy = Math.round(cy + j);
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      px[yy * W + xx] = d < 1.5 ? 230 : d < 4 ? 20 : d < 6 ? 200 : 30;
    }
  }
  return { w: W, h: H, px };
}

type Seg = { ms: number; to?: [number, number]; plate?: boolean };
/** Runs a path of segments (each moving linearly to `to`, or holding) through the stage, from frame 0. */
function run(st: BarStage, start: [number, number], segs: Seg[], t0 = 0) {
  const evs: BarStageEvent[] = [];
  let [x, y] = start, t = t0, k = Math.round(t0 / DT);
  for (const s of segs) {
    const [x0, y0] = [x, y], [x1, y1] = s.to ?? [x, y];
    const n = Math.round(s.ms / DT);
    for (let i = 1; i <= n; i++) {
      x = x0 + ((x1 - x0) * i) / n; y = y0 + ((y1 - y0) * i) / n; t += DT; k++;
      evs.push(...st.feed(frame(x, y, k, s.plate !== false), Math.round(t)));
    }
  }
  return { evs, t, at: [x, y] as [number, number] };
}
const cmds = (evs: BarStageEvent[]) => evs.filter(e => e.type === 'cmd').map(e => (e.type === 'cmd' ? `${e.cmd}${e.void ? '(void)' : ''}${e.late ? '(late)' : ''}` : ''));

// A bench: on the hooks, lift-out up and over, held at arms' length, down to the chest, the pause, up, held.
const RACK: [number, number] = [0.62, 0.3];
const BENCH: Seg[] = [
  { ms: 1500 },
  { ms: 600, to: [0.55, 0.22] },
  { ms: 1200 },
  { ms: 1000, to: [0.55, 0.42] },
  { ms: 1300 },
  { ms: 900, to: [0.55, 0.22] },
  { ms: 1200 },
];

describe('the bench stage (3.4b)', () => {
  it('takes her tap as plate_tap, follows the plate, and calls Start!, Press! and Rack!', () => {
    const st = new BarStage(DIMS);
    expect(st.state).toBe('tap');
    expect(st.feed(frame(...RACK, 0), 0)).toEqual([]);
    expect(st.tap(frame(...RACK, 0), RACK[0] + 0.004, RACK[1] - 0.004)).toBe(true);
    expect(st.plateTap).toEqual({ x: 0.624, y: 0.296, size: 0.08 });
    const { evs } = run(st, RACK, BENCH);
    expect(cmds(evs)).toEqual(['start', 'press', 'rack']);
    // the mark follows the plate on the hooks, and goes at "Start!"
    const start = evs.findIndex(e => e.type === 'cmd');
    const marks = evs.slice(0, start).filter(e => e.type === 'mark');
    expect(marks.length).toBeGreaterThan(60);
    const m0 = marks[5] as { x: number; y: number };
    expect(Math.abs(m0.x - RACK[0]) * W).toBeLessThan(2.5);
    expect(Math.abs(m0.y - RACK[1]) * H).toBeLessThan(2.5);
    expect(evs.slice(start).some(e => e.type === 'mark')).toBe(false);
    // the path is every frame, none lost
    expect(st.path.length).toBeGreaterThan(200);
    expect(st.path.every(p => !p.lost)).toBe(true);
    expect(st.state).toBe('done');
    expect(st.voided).toBe(false);
    // no tap once the lift has started
    expect(st.tap(frame(...RACK, 0), 0.5, 0.5)).toBe(false);
  });

  it('is lost on the hooks after 1 s under the line: the mark goes, and a new tap starts again', () => {
    const st = new BarStage(DIMS);
    st.tap(frame(...RACK, 0), ...RACK);
    const a = run(st, RACK, [{ ms: 500 }, { ms: 1500, plate: false }]);
    const lost = a.evs.filter(e => e.type === 'lost');
    expect(lost).toHaveLength(1);
    // 1 s after the plate went (500 ms in), within a frame or two
    expect(lost[0].t).toBeGreaterThanOrEqual(1500);
    expect(lost[0].t).toBeLessThanOrEqual(1500 + 3 * DT);
    expect(st.state).toBe('tap');
    expect(st.plateTap).toBeNull();
    // nothing more until she taps again
    expect(st.feed(frame(...RACK, 99), a.t + DT)).toEqual([]);
    expect(st.tap(frame(...RACK, 100), ...RACK)).toBe(true);
    const b = run(st, RACK, BENCH, a.t + DT);
    expect(cmds(b.evs)).toEqual(['start', 'press', 'rack']);
  });

  it('moves the mark on a second tap before Start!', () => {
    const st = new BarStage(DIMS);
    st.tap(frame(...RACK, 0), 0.3, 0.7); // the wrong place: a patch of wall
    run(st, RACK, [{ ms: 300 }]);
    expect(st.tap(frame(...RACK, 10), ...RACK)).toBe(true);
    expect(st.plateTap).toEqual({ x: RACK[0], y: RACK[1], size: 0.08 });
    const { evs } = run(st, RACK, BENCH, 300);
    const m = evs.find(e => e.type === 'mark') as { x: number; y: number };
    expect(Math.abs(m.x - RACK[0]) * W).toBeLessThan(2.5);
    expect(cmds(evs)).toEqual(['start', 'press', 'rack']);
  });

  it('calls a void Rack! with no Start! within 5 s of leaving the hooks', () => {
    const st = new BarStage(DIMS);
    st.tap(frame(...RACK, 0), ...RACK);
    // out of the rack, then never still: it wanders
    const wander: Seg[] = [{ ms: 1000 }, { ms: 600, to: [0.55, 0.22] }];
    for (let i = 0; i < 12; i++) wander.push({ ms: 500, to: i % 2 ? [0.55, 0.22] : [0.5, 0.27] });
    const { evs } = run(st, RACK, wander);
    expect(cmds(evs)).toEqual(['rack(void)']);
    expect(st.voided).toBe(true);
    expect(st.state).toBe('done');
  });

  it('breaks the path where the plate was lost after Start!, and calls the late Press!', () => {
    const st = new BarStage(DIMS);
    st.tap(frame(...RACK, 0), ...RACK);
    const { evs } = run(st, RACK, [...BENCH.slice(0, 3), { ms: 500, to: [0.55, 0.3] }, { ms: 2600, plate: false }, { ms: 3200, plate: false }]);
    expect(cmds(evs)).toEqual(['start', 'press(late)', 'rack']);
    const press = evs.find(e => e.type === 'cmd' && e.cmd === 'press') as { why?: string };
    expect(press.why).toBe('lost');
    expect(st.path.some(p => p.lost)).toBe(true);
  });
});
