// Drawn frames for the phone's bench (plan 3.4b): a plate on a textured room, moving the way a bench moves,
// on the small grey frame the bar stage tracks. Shared by bar-stage.test.ts and meet-lift.test.ts.
import { smallWidth, type BarStageEvent } from '../../web/lib/judge/bar-stage';
import { BAR_FRAME_H, type Gray } from '../../web/lib/judge/plate-tracker';

export const H = BAR_FRAME_H, W = smallWidth(1280, 720, H); // a phone on its side
export const DIMS = { w: 1280, h: 720 };
export const FPS = 30, DT = 1000 / FPS;

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const room = (() => { const r = rng(7); const px = new Uint8Array(W * H); for (let i = 0; i < px.length; i++) px[i] = 90 + Math.floor(r() * 40); return px; })();

/**
 * One frame with the plate at (x, y), fractions of the frame; none if `plate` is false. Like a real camera:
 * sensor noise, and a held bar that is never quite still (a pixel or so of sway at this size), so the
 * stuck-track rule (a score of 0.99 with under 1 px of movement) never takes it for a frozen track.
 */
export function frame(x: number, y: number, k: number, plate = true): Gray {
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

export type Seg = { ms: number; to?: [number, number]; plate?: boolean };
/** Runs a path of segments (each moving linearly to `to`, or holding) through the stage, from frame 0. */
export function run<E = BarStageEvent>(st: { feed(g: Gray, t: number): E[] }, start: [number, number], segs: Seg[], t0 = 0) {
  const evs: E[] = [];
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
export const cmds = (evs: BarStageEvent[]) => evs.filter(e => e.type === 'cmd').map(e => (e.type === 'cmd' ? `${e.cmd}${e.void ? '(void)' : ''}${e.late ? '(late)' : ''}` : ''));

// A bench: on the hooks, lift-out up and over, held at arms' length, down to the chest, the pause, up, held.
export const RACK: [number, number] = [0.62, 0.3];
export const BENCH: Seg[] = [
  { ms: 1500 },
  { ms: 600, to: [0.55, 0.22] },
  { ms: 1200 },
  { ms: 1000, to: [0.55, 0.42] },
  { ms: 1300 },
  { ms: 900, to: [0.55, 0.22] },
  { ms: 1200 },
];

