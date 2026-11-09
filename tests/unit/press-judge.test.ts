// The press judges on synthetic poses: the Barbell bench (3.4) and Home's overhead press (3.7).
import { describe, expect, it } from 'vitest';
import { BenchCaller, judgePress, pressTimes, type PressCommand } from '@/lib/judge/press';
import { OverheadCaller, judgeOverhead, type OverheadCommand } from '@/lib/judge/overhead';
import { judgeAttempt } from '@/lib/judge/attempt';
import type { Frame, Pt } from '@/lib/judge/pose';

const d = { w: 1000, h: 1000 };
const STEP = 1000 / 15;

/**
 * A side-on figure from the left: the left arm near (vis 0.95), the right arm behind it. The arm
 * hangs from the shoulder at (500, 400); `upper` and `fore` are the directions (degrees, 0 = right,
 * 90 = down) of the upper arm and forearm, 120 px each.
 */
function arm(upper: number, fore: number, opts: { jitter?: number; t?: number } = {}): Pt[] {
  const p: Pt[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0.95] as Pt);
  const j = (k: number) => (opts.jitter ? opts.jitter * Math.sin((opts.t ?? 0) * 0.013 + k) : 0);
  const rad = (a: number) => (a * Math.PI) / 180;
  const sh = { x: 500, y: 400 };
  const el = { x: sh.x + 120 * Math.cos(rad(upper)), y: sh.y + 120 * Math.sin(rad(upper)) };
  const wr = { x: el.x + 120 * Math.cos(rad(fore)) + j(1), y: el.y + 120 * Math.sin(rad(fore)) + j(2) };
  const set = (i: number, x: number, y: number, v = 0.95) => { p[i] = [x / d.w, y / d.h, v]; };
  set(0, 520, 330); set(7, 500, 335); set(8, 500, 335, 0.4); // nose, ears
  for (const [s, e, w, v] of [[11, 13, 15, 0.95], [12, 14, 16, 0.95]] as const) {
    set(s, sh.x, sh.y, v); set(e, el.x, el.y, v); set(w, wr.x, wr.y, v);
  }
  set(23, 500, 600); set(24, 500, 600, 0.4); set(25, 500, 780); set(26, 500, 780, 0.4);
  set(27, 500, 950); set(28, 500, 950, 0.4); set(29, 490, 960); set(30, 490, 960, 0.4); set(31, 540, 965); set(32, 540, 965, 0.4);
  return p;
}

/** Holds a pose for `ms`, from `t0`, with a little landmark jitter (as MediaPipe gives). */
const hold = (t0: number, ms: number, pose: (t: number) => Pt[]): Frame[] =>
  Array.from({ length: Math.round(ms / STEP) }, (_, i) => ({ t: Math.round(t0 + i * STEP), p: pose(t0 + i * STEP) }));

/** Moves from one arm pose to another over `ms`. */
const move = (t0: number, ms: number, a: [number, number], b: [number, number]): Frame[] =>
  hold(t0, ms, t => { const k = (t - t0) / ms; return arm(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k); });

// Bench, lying: arm straight up (upper and fore both pointing up, -90), and down (elbow out, forearm up).
const UP: [number, number] = [-90, -90];
const DOWN: [number, number] = [10, -80]; // elbow ~90°

function runBench(frames: Frame[]) {
  const c = new BenchCaller(d);
  const ct: Record<string, number> = { loaded: 0 };
  const cmds: PressCommand[] = [];
  for (const f of frames) {
    let x = c.feed(f);
    while (x) {
      cmds.push(x);
      ct[x.cmd === 'press' ? 'press' : x.cmd === 'rep' ? `rep_${x.k}` : x.cmd] = x.t;
      x = x.cmd === 'rep' ? c.feed(f) : null;
    }
  }
  return { ct, cmds };
}

describe('bench (Barbell)', () => {
  const still = (t0: number, ms: number, a: [number, number]) => hold(t0, ms, t => arm(a[0], a[1], { jitter: 2, t }));
  const paused = [
    ...still(0, 1000, UP), ...move(1000, 1000, UP, DOWN), ...still(2000, 900, DOWN),
    ...move(2900, 800, DOWN, UP), ...still(3700, 1000, UP),
  ];

  it('calls Start!, Press! on the still bottom, then Rack! after the lockout', () => {
    const { cmds } = runBench(paused);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'press', 'rep', 'rack']);
  });

  it('gives a white to a paused rep pressed on the call', () => {
    const { ct } = runBench(paused);
    const r = judgePress(paused, d, { start: ct.start, end: ct.rack }, pressTimes(ct));
    expect(r.call).toEqual({ light: 'white' });
  });

  it('gives red no_pause when the bar went down and up with no "Press!"', () => {
    const tng = [...still(0, 1000, UP), ...move(1000, 700, UP, DOWN), ...move(1700, 700, DOWN, UP), ...still(2400, 1000, UP)];
    const { ct } = runBench(tng);
    expect(ct.press).toBeUndefined();
    const r = judgePress(tng, d, { start: ct.start, end: ct.rack ?? 3400 }, pressTimes(ct));
    expect(r.call).toEqual({ light: 'red', reason: 'no_pause' });
  });

  it('gives red no_lockout when the elbows never straighten after "Press!"', () => {
    const half: [number, number] = [-40, -90]; // elbow ~130°
    const frames = [...still(0, 1000, UP), ...move(1000, 1000, UP, DOWN), ...still(2000, 900, DOWN), ...move(2900, 600, DOWN, half), ...still(3500, 2000, half)];
    const { ct } = runBench(frames);
    expect(ct.press).toBeDefined();
    const r = judgePress(frames, d, { start: ct.start, end: 5500 }, pressTimes(ct));
    expect(r.call).toEqual({ light: 'red', reason: 'no_lockout' });
  });

  it('a Barbell bench attempt is judged, not sent to a referee', () => {
    const { ct } = runBench(paused);
    const v = judgeAttempt(paused, { ...d, duration: 4.7 }, 'bench', ct);
    expect(v.call).toEqual({ light: 'white' });
    expect(v.measures.press_ms).toBe(ct.press);
  });
});

// Overhead, standing: dumbbells at the shoulders (upper arm down and forward, forearm up), and locked.
const RACKED: [number, number] = [60, -100]; // elbow ~20°, wrist near shoulder height
const LOCKED: [number, number] = [-90, -90];
const BENT_TOP: [number, number] = [-60, -100]; // wrists above the nose, elbows ~140°

function runOverhead(frames: Frame[], reps: number) {
  const c = new OverheadCaller(d, undefined, { reps });
  const ct: Record<string, number> = { ready: 0 };
  const cmds: OverheadCommand[] = [];
  for (const f of frames) {
    let x = c.feed(f);
    while (x) {
      cmds.push(x);
      ct[x.cmd === 'rep' ? `rep_${x.k}` : x.cmd] = x.t;
      x = x.cmd === 'rep' ? c.feed(f) : null;
    }
  }
  return { ct, cmds };
}

describe('overhead press (Home)', () => {
  const still = (t0: number, ms: number, a: [number, number]) => hold(t0, ms, t => arm(a[0], a[1], { jitter: 2, t }));
  const rep = (t0: number, top: [number, number] = LOCKED, holdMs = 800) => [
    ...move(t0, 700, RACKED, top), ...still(t0 + 700, holdMs, top), ...move(t0 + 700 + holdMs, 700, top, RACKED), ...still(t0 + 1400 + holdMs, 300, RACKED),
  ];

  it('calls Start! at the shoulders, a rep at each held lockout, then Rack!', () => {
    const frames = [...still(0, 1000, RACKED), ...rep(1000), ...rep(3200)];
    const { cmds } = runOverhead(frames, 2);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'rep', 'rep', 'rack']);
  });

  it('never calls "Press!"', () => {
    const frames = [...still(0, 1000, RACKED), ...rep(1000)];
    expect(runOverhead(frames, 1).cmds.some(c => (c.cmd as string) === 'press')).toBe(false);
  });

  it('gives a white to every locked, held rep', () => {
    const frames = [...still(0, 1000, RACKED), ...rep(1000), ...rep(3200)];
    const { ct } = runOverhead(frames, 2);
    const r = judgeOverhead(frames, d, { start: ct.start, end: ct.rack }, pressTimes(ct).repEnds, 2);
    expect(r.reps.map(x => x.call.light)).toEqual(['white', 'white']);
    expect(r.call).toEqual({ light: 'white' });
  });

  it('gives red no_lockout to a rep that stops short of a lockout, and Home\'s 8 s rule racks the set', () => {
    const frames = [...still(0, 1000, RACKED), ...rep(1000), ...rep(3200, BENT_TOP, 1000), ...still(6100, 9000, RACKED)];
    const { ct, cmds } = runOverhead(frames, 2);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'rep', 'rack']);
    const r = judgeOverhead(frames, d, { start: ct.start, end: ct.rack }, pressTimes(ct).repEnds, 2);
    expect(r.reps.map(x => x.call)).toEqual([{ light: 'white' }, { light: 'red', reason: 'no_lockout' }]);
    expect(r.call).toEqual({ light: 'red', reason: 'no_lockout' });
  });

  it('gives a close call borderline_lockout to a rep held between 155° and 165°', () => {
    const NEAR: [number, number] = [-80, -100]; // elbows ~160°, wrists above the nose
    const frames = [...still(0, 1000, RACKED), ...rep(1000, NEAR, 1000), ...still(3700, 18000, RACKED)];
    const { ct, cmds } = runOverhead(frames, 1);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'rack']);
    const r = judgeOverhead(frames, d, { start: ct.start, end: ct.rack }, pressTimes(ct).repEnds, 1);
    expect(r.reps[0].call).toEqual({ light: 'close', reason: 'borderline_lockout' });
    expect(r.reps[0].lockoutElbowDeg).toBeGreaterThan(155);
    expect(r.reps[0].lockoutElbowDeg).toBeLessThanOrEqual(165);
  });

  it('counts a lockout whose dumbbells settle a little (under 12% of the arm in 0.4 s), not one that keeps moving', () => {
    // the wrists sink `px` pixels over the 800 ms hold at the top (the arm is 240 px)
    const settle = (px: number) => (t0: number) => hold(t0, 800, t => {
      const p = arm(LOCKED[0], LOCKED[1]);
      const dy = (px * (t - t0)) / 800 / d.h;
      p[15] = [p[15][0], p[15][1] + dy, p[15][2]]; p[16] = [p[16][0], p[16][1] + dy, p[16][2]];
      return p;
    });
    const set = (px: number) => [
      ...still(0, 1000, RACKED), ...move(1000, 700, RACKED, LOCKED), ...settle(px)(1700),
      ...move(2500, 700, LOCKED, RACKED), ...still(3200, 300, RACKED),
    ];
    const ok = set(40); // 20 px in 0.4 s: 8% of the arm
    const { ct, cmds } = runOverhead(ok, 1);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'rep', 'rack']);
    expect(judgeOverhead(ok, d, { start: ct.start, end: ct.rack }, pressTimes(ct).repEnds, 1).call).toEqual({ light: 'white' });
    expect(runOverhead(set(120), 1).cmds.map(c => c.cmd)).toEqual(['start']); // 60 px in 0.4 s: 25%
  });

  it('waits for "Start!" while the elbows are over 100° or the wrists are above the nose', () => {
    const HIGH: [number, number] = [-20, -100]; // wrists above the nose
    const OPEN: [number, number] = [70, 20]; // elbows ~130°, wrists below the nose
    expect(runOverhead([...still(0, 2000, HIGH)], 1).cmds).toEqual([]);
    expect(runOverhead([...still(0, 2000, OPEN)], 1).cmds).toEqual([]);
  });

  it('a failed rep before a good one is the red: the first time the wrists go above the nose', () => {
    const frames = [...still(0, 1000, RACKED), ...rep(1000, BENT_TOP, 600), ...rep(3000)];
    const { ct, cmds } = runOverhead(frames, 1);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'rep', 'rack']);
    const r = judgeOverhead(frames, d, { start: ct.start, end: ct.rack }, pressTimes(ct).repEnds, 1);
    expect(r.reps[0].call).toEqual({ light: 'red', reason: 'no_lockout' });
  });

  it('a Home bench attempt is the overhead press, judged per declared rep', () => {
    const frames = [...still(0, 1000, RACKED), ...rep(1000), ...rep(3200)];
    const { ct } = runOverhead(frames, 2);
    const v = judgeAttempt(frames, { ...d, duration: 6 }, 'bench', ct, undefined, 2);
    expect(v.call).toEqual({ light: 'white' });
    expect(v.repLights?.map(x => x.call)).toEqual(['white', 'white']);
  });
});
