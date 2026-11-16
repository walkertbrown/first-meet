// Synthetic press poses for the press tests (press-judge, meet-lift).
import type { Frame, Pt } from '@/lib/judge/pose';

export const d = { w: 1000, h: 1000 };
export const STEP = 1000 / 15;

/**
 * A side-on figure from the left: the left arm near (vis 0.95), the right arm behind it. The arm
 * hangs from the shoulder at (500, 400); `upper` and `fore` are the directions (degrees, 0 = right,
 * 90 = down) of the upper arm and forearm, 120 px each.
 */
export function arm(upper: number, fore: number, opts: { jitter?: number; t?: number } = {}): Pt[] {
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
export const hold = (t0: number, ms: number, pose: (t: number) => Pt[]): Frame[] =>
  Array.from({ length: Math.round(ms / STEP) }, (_, i) => ({ t: Math.round(t0 + i * STEP), p: pose(t0 + i * STEP) }));

/** Moves from one arm pose to another over `ms`. */
export const move = (t0: number, ms: number, a: [number, number], b: [number, number]): Frame[] =>
  hold(t0, ms, t => { const k = (t - t0) / ms; return arm(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k); });

// Bench, lying: arm straight up (upper and fore both pointing up, -90), and down (elbow out, forearm up).
export const UP: [number, number] = [-90, -90];
export const DOWN: [number, number] = [10, -80]; // elbow ~90°

// Overhead, standing: dumbbells at the shoulders (upper arm down and forward, forearm up), and locked.
export const RACKED: [number, number] = [60, -100]; // elbow ~20°, wrist near shoulder height
export const LOCKED: [number, number] = [-90, -90];
export const BENT_TOP: [number, number] = [-60, -100]; // wrists above the nose, elbows ~140°


/**
 * Home's overhead press, filmed front-on (3.4c): shoulders at (440, 400) and (560, 400), hips 200 px
 * below (the shoulders 0.6 × the torso apart), the nose at (500, 330). `upper` and `fore` are the
 * left arm's directions (degrees, 0 = right, 90 = down), 120 px each; the right arm mirrors it.
 * `vis` overrides points' visibility.
 */
export function front(upper: number, fore: number, opts: { jitter?: number; t?: number; vis?: Record<number, number>; dy?: number } = {}): Pt[] {
  const p: Pt[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0.95] as Pt);
  const j = (k: number) => (opts.jitter ? opts.jitter * Math.sin((opts.t ?? 0) * 0.013 + k) : 0);
  const rad = (a: number) => (a * Math.PI) / 180;
  const dy = opts.dy ?? 0;
  const set = (i: number, x: number, y: number) => { p[i] = [x / d.w, (y + dy) / d.h, opts.vis?.[i] ?? 0.95]; };
  set(0, 500, 330); set(7, 480, 335); set(8, 520, 335);
  for (const [s, e, w, sx, flip] of [[11, 13, 15, 440, 1], [12, 14, 16, 560, -1]] as const) {
    const u = flip === 1 ? upper : 180 - upper, f = flip === 1 ? fore : 180 - fore;
    const el = { x: sx + 120 * Math.cos(rad(u)), y: 400 + 120 * Math.sin(rad(u)) };
    set(s, sx, 400); set(e, el.x, el.y);
    set(w, el.x + 120 * Math.cos(rad(f)) + j(s), el.y + 120 * Math.sin(rad(f)) + j(s + 1));
  }
  set(23, 450, 600); set(24, 550, 600); set(25, 455, 780); set(26, 545, 780);
  set(27, 460, 950); set(28, 540, 950); set(29, 455, 960); set(30, 545, 960); set(31, 450, 965); set(32, 550, 965);
  return p;
}

/** Moves the front-on arms from one pose to another over `ms`. */
export const moveFront = (t0: number, ms: number, a: [number, number], b: [number, number]): Frame[] =>
  hold(t0, ms, t => { const k = (t - t0) / ms; return front(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k); });

// Front-on: dumbbells at the shoulders (upper arm down and out, forearm up; elbow 45°, the wrists
// 35 px below the nose); locked (180°); and three tops with the wrists above the nose.
export const F_RACKED: [number, number] = [135, -90];
export const F_LOCKED: [number, number] = [-90, -90];
export const F_NEAR: [number, number] = [-110, -70]; // elbows 140°
export const F_BENT: [number, number] = [-120, -60]; // elbows 120°
