// Pose points and the geometry the one judge needs (plan 3.4).
// MediaPipe Pose gives 33 points per frame, each [x, y, visibility, z] with x and y
// from 0 to 1 across the image. The judge works in pixels so angles are true.

export type Pt = [number, number, number] | [number, number, number, number];
export type Frame = { t: number; p: Pt[] | null };
export type Dims = { w: number; h: number };

export const L = {
  nose: 0, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30,
} as const;

export type Side = 'left' | 'right';
export type SidePts = { shoulder: number; elbow: number; wrist: number; hip: number; knee: number; ankle: number; heel: number; ear: number };

export const SIDES: Record<Side, SidePts> = {
  left: { shoulder: L.leftShoulder, elbow: L.leftElbow, wrist: L.leftWrist, hip: L.leftHip, knee: L.leftKnee, ankle: L.leftAnkle, heel: L.leftHeel, ear: L.leftEar },
  right: { shoulder: L.rightShoulder, elbow: L.rightElbow, wrist: L.rightWrist, hip: L.rightHip, knee: L.rightKnee, ankle: L.rightAnkle, heel: L.rightHeel, ear: L.rightEar },
};

const KEY = ['shoulder', 'hip', 'knee', 'ankle'] as const;

/** Summed visibility of shoulder, hip, knee and ankle for one side, over the frames given. */
export function sideVisibility(frames: Frame[], side: Side): number {
  const s = SIDES[side];
  let sum = 0;
  for (const f of frames) if (f.p) for (const k of KEY) sum += f.p[s[k]][2];
  return sum;
}

/** The side nearer the camera: the higher summed visibility of shoulder, hip, knee and ankle. */
export function nearSide(frames: Frame[] | Frame): Side {
  const list = Array.isArray(frames) ? frames : [frames];
  return sideVisibility(list, 'left') >= sideVisibility(list, 'right') ? 'left' : 'right';
}

export type XY = { x: number; y: number; v: number };
export const px = (p: Pt[], i: number, d: Dims): XY => ({ x: p[i][0] * d.w, y: p[i][1] * d.h, v: p[i][2] });
export const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

/** The angle at b, in degrees, between b→a and b→c. */
export function angle(a: XY, b: XY, c: XY): number {
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!n) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n))) * 180) / Math.PI;
}

/** Shoulder midpoint to hip midpoint, in pixels. */
export function torsoLength(p: Pt[], d: Dims): number {
  const sm = mid(px(p, L.leftShoulder, d), px(p, L.rightShoulder, d));
  const hm = mid(px(p, L.leftHip, d), px(p, L.rightHip, d));
  return dist(sm, hm) || 1;
}

export const mid = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });

/** The measures for one frame on one side. */
export function measure(p: Pt[], d: Dims, side: Side) {
  const s = SIDES[side];
  const sh = px(p, s.shoulder, d), hip = px(p, s.hip, d), knee = px(p, s.knee, d), ankle = px(p, s.ankle, d);
  const thigh = dist(hip, knee) || 1;
  return {
    sh, hip, knee, ankle,
    knee_deg: angle(hip, knee, ankle),
    hip_deg: angle(sh, hip, knee),
    depth: (hip.y - knee.y) / thigh,
    thigh,
    torso: torsoLength(p, d),
    minVis: Math.min(sh.v, hip.v, knee.v, ankle.v),
  };
}
export type Measures = ReturnType<typeof measure>;
