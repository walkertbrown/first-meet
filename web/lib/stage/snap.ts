// The frozen frame is the judged moment (look, For The Playner 2): the bottom of the squat.
// The judge picks the frame where the hips are lowest against the knees, on the side
// nearest the phone, so while she lifts we keep a picture of the deepest frame on each
// side. Once the judge has its call, the one on its side is the judged frame.
import { measure, type Dims, type Frame, type Pt, type Side } from '@/lib/judge';

export type Snap = { t: number; depth: number; p: Pt[]; canvas: HTMLCanvasElement };

export class DeepestFrames {
  private best: Record<Side, Snap | null> = { left: null, right: null };
  constructor(private d: Dims) {}

  /** Call with each frame while she lifts, and the video it came from. */
  offer(f: Frame, src: HTMLVideoElement) {
    if (!f.p) return;
    for (const side of ['left', 'right'] as const) {
      const depth = measure(f.p, this.d, side).depth;
      const b = this.best[side];
      if (b && depth <= b.depth) continue;
      const canvas = b?.canvas ?? document.createElement('canvas');
      canvas.width = this.d.w;
      canvas.height = this.d.h;
      canvas.getContext('2d')!.drawImage(src, 0, 0, this.d.w, this.d.h);
      this.best[side] = { t: f.t, depth, p: f.p, canvas };
    }
  }

  get(side: Side): Snap | null { return this.best[side]; }
}

/** The judge's marks on the judged frame (look 9, step 10), in the frame's own pixels. */
export function marksOf(p: Pt[], side: Side, d: Dims) {
  const m = measure(p, d, side);
  return { hip: { x: m.hip.x, y: m.hip.y }, knee: { x: m.knee.x, y: m.knee.y } };
}
export type Marks = ReturnType<typeof marksOf>;
