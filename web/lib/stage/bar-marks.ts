// The Barbell bench on the stage (plan 3.4b, look 5.14c): the small grey frame the bar stage reads, where
// her tap lands on the camera frame, the bar mark's size, and her clip's path and ticks. Plain TS, so the
// unit tests check the numbers the stage draws.
import type { BarPathPoint } from '@/lib/judge/bar-stage';
import type { Gray } from '@/lib/judge/plate-tracker';

/**
 * The grey frame: the video drawn at w x h on a canvas, and its luma (BT.601, as PyAV's `gray` on the
 * worker, worker/plate.py). Returns null before the video has a frame.
 */
export function greyFrame(src: CanvasImageSource, canvas: HTMLCanvasElement, w: number, h: number): Gray | null {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  return { w, h, px: lumaOf(ctx.getImageData(0, 0, w, h).data) };
}

/** RGBA to luma: (77 r + 150 g + 29 b) >> 8, the integer BT.601 weights. */
export function lumaOf(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const n = rgba.length >> 2, out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = (77 * rgba[j] + 150 * rgba[j + 1] + 29 * rgba[j + 2]) >> 8;
  return out;
}

/**
 * Her tap, as fractions of the camera frame (look 5.14c: the whole camera view is the target, no
 * snapping). `box` is the footage on screen; the camera's footage is mirrored there, the frame is not.
 */
export function tapToFrame(box: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number, mirrored: boolean) {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x = clamp((clientX - box.left) / (box.width || 1));
  const y = clamp((clientY - box.top) / (box.height || 1));
  return { x: mirrored ? 1 - x : x, y };
}

/** Where a frame point sits on the stage, in px: the mirrored footage puts x at 1 - x. */
export function frameToStage(box: { left: number; top: number; width: number; height: number }, x: number, y: number, mirrored: boolean) {
  return { x: box.left + (mirrored ? 1 - x : x) * box.width, y: box.top + y * box.height };
}

/** The bar mark's square (look 5.14c): the template's size (a fraction of the frame's height) plus 12 px each side, at least 44 px. */
export const markSide = (footageHeightPx: number, tplSize: number) => Math.max(44, Math.round(tplSize * footageHeightPx) + 24);

/** The path drawn in pieces: nothing for a lost frame (look 5.14c, "the path breaks"). */
export function pathPieces(path: BarPathPoint[]): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] | null = null;
  for (const q of path) {
    if (q.lost) { cur = null; continue; }
    if (!cur) { cur = []; out.push(cur); }
    cur.push({ x: q.x, y: q.y });
  }
  return out;
}

/**
 * Where a command's tick sits: the path's point at its time, or, if that came in a lost stretch (a
 * `press_late` "Press!"), the last point the plate was seen. Null with no seen point before it.
 */
export function tickAt(path: BarPathPoint[], t: number): { x: number; y: number } | null {
  let seen: BarPathPoint | null = null;
  for (const q of path) {
    if (q.t > t) break;
    if (!q.lost) seen = q;
  }
  return seen && { x: seen.x, y: seen.y };
}
