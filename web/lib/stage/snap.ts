// The frozen frame is the judged moment (look, For The Playner 2): the bottom of the squat.
// The judge picks the frame where the hips are lowest against the knees, on the side
// nearest the phone, so while she lifts we keep a picture of the deepest frame on each
// side. Once the judge has its call, the one on its side is the judged frame.
import { measure, type Dims, type Frame, type Pt, type Side } from '@/lib/judge';
import { nearSide, px, SIDES } from '@/lib/judge/pose';
import { JUDGED_POINTS } from '@/lib/judge/call';

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

/**
 * The marks for any lift (3.4: "the marks are drawn on" the judged frame): the points its call is
 * measured from, joined. The squat keeps hip to knee (look 9 step 10); the deadlift is hip, knee
 * and ankle; the presses are shoulder, elbow and wrist (JUDGED_POINTS).
 */
export function liftMarks(lift: string, p: Pt[], d: Dims, side: Side = nearSide({ t: 0, p })): { pts: { x: number; y: number }[] } {
  if (lift === 'squat') { const m = marksOf(p, side, d); return { pts: [m.hip, m.knee] }; }
  const keys = lift === 'deadlift' ? JUDGED_POINTS.deadlift : JUDGED_POINTS.press;
  return { pts: keys.map(k => { const q = px(p, SIDES[side][k], d); return { x: q.x, y: q.y }; }) };
}
export type LiftMarks = ReturnType<typeof liftMarks>;
