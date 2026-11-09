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

