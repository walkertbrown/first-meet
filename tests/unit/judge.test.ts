// The judge's rules on made-up poses (plan 3.4), so each rule is tested on its own.
import { describe, expect, it } from 'vitest';
import { JUDGED_POINTS, judgeDeadlift, judgedFrameSeen, judgeSquat, L, type Frame, type Pt } from '../../web/lib/judge';

const D = { w: 1000, h: 1000 };

/** A side-on figure seen from its left, every point 0.95 visible unless changed. */
function body(o: { hipDeg?: number; kneeDeg?: number; vis?: Partial<Record<number, number>>; at?: Partial<Record<number, [number, number]>> } = {}): Pt[] {
  const p: Pt[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0.95, 0] as Pt);
  const set = (i: number, x: number, y: number) => { p[i] = [x, y, o.vis?.[i] ?? 0.95, 0]; };
  // knee, then the hip above-and-behind it at the knee angle, then the shoulder at the hip angle
  const knee = { x: 0.5, y: 0.7 };
  const ankle = { x: 0.5, y: 0.9 };
  const k = ((o.kneeDeg ?? 180) * Math.PI) / 180;
  const hip = { x: knee.x - 0.2 * Math.sin(Math.PI - k), y: knee.y - 0.2 * Math.cos(Math.PI - k) };
  const h = ((o.hipDeg ?? 180) * Math.PI) / 180;
  const thighDir = Math.atan2(knee.y - hip.y, knee.x - hip.x);
  const shDir = thighDir + h;
  const sh = { x: hip.x + 0.25 * Math.cos(shDir), y: hip.y + 0.25 * Math.sin(shDir) };
  for (const [l, r] of [[L.leftShoulder, L.rightShoulder], [L.leftHip, L.rightHip], [L.leftKnee, L.rightKnee], [L.leftAnkle, L.rightAnkle]] as const) {
    const pt = l === L.leftShoulder ? sh : l === L.leftHip ? hip : l === L.leftKnee ? knee : ankle;
    set(l, pt.x, pt.y);
    set(r, pt.x + 0.01, pt.y);
    p[r][2] = 0.4; // the far side is less visible, so the near side is the left
  }
  set(L.leftElbow, sh.x + 0.1, sh.y + 0.1); set(L.leftWrist, sh.x + 0.2, sh.y);
  set(L.leftHeel, 0.48, 0.92); set(L.nose, sh.x, sh.y - 0.1);
  for (const [i, xy] of Object.entries(o.at ?? {})) { p[+i][0] = xy![0]; p[+i][1] = xy![1]; }
  return p;
}

describe('visibility on the judged frame (3.4, item 48)', () => {
  it('passes when the hip, knee and ankle are seen and inside the frame', () => {
    expect(judgedFrameSeen(body(), 'left', JUDGED_POINTS.squat)).toBe(true);
  });
  it('fails when a point is under 0.5 visible', () => {
    expect(judgedFrameSeen(body({ vis: { [L.leftAnkle]: 0.49 } }), 'left', JUDGED_POINTS.squat)).toBe(false);
  });
  it('fails when a point sits outside the 3% margin, however visible', () => {
    expect(judgedFrameSeen(body({ at: { [L.leftKnee]: [0.5, 0.98] } }), 'left', JUDGED_POINTS.squat)).toBe(false);
    expect(judgedFrameSeen(body({ at: { [L.leftKnee]: [0.5, 0.97] } }), 'left', JUDGED_POINTS.squat)).toBe(true);
  });
  it('checks the shoulder, elbow and wrist for the presses', () => {
    expect(JUDGED_POINTS.press).toEqual(['shoulder', 'elbow', 'wrist']);
    expect(judgedFrameSeen(body({ vis: { [L.leftAnkle]: 0.1 } }), 'left', JUDGED_POINTS.press)).toBe(true);
    expect(judgedFrameSeen(body({ vis: { [L.leftWrist]: 0.3 } }), 'left', JUDGED_POINTS.press)).toBe(false);
  });

  const squat = (bottom: Pt[]): Frame[] => {
    const f: Frame[] = [];
    for (let t = 0; t < 1000; t += 66) f.push({ t, p: body() });
    f.push({ t: 1000, p: body({ kneeDeg: 120 }) }, { t: 1066, p: bottom }, { t: 1133, p: body({ kneeDeg: 120 }) });
    for (let t = 1200; t < 2000; t += 66) f.push({ t, p: body() });
    return f;
  };
  it('turns a squat whose ankle is out of the picture into a close call, never a white', () => {
    const deep = body({ kneeDeg: 40, hipDeg: 50 });
    const r1 = judgeSquat(squat(deep), D, { start: 0, end: 2000 });
    expect(r1.reps[0].call).toEqual({ light: 'white' });
    const hidden = body({ kneeDeg: 40, hipDeg: 50, at: { [L.leftAnkle]: [0.5, 1.2] } });
    const r2 = judgeSquat(squat(hidden), D, { start: 0, end: 2000 });
    expect(r2.reps[0].call).toEqual({ light: 'close', reason: 'visibility' });
  });
});

describe('deadlift hitch', () => {
  const pull = (hips: number[], t0: number): Frame[] => hips.map((h, i) => ({ t: t0 + i * 66, p: body({ hipDeg: h, kneeDeg: h < 165 ? 150 : 178 }) }));
  const hold = (t0: number) => Array.from({ length: 8 }, (_, i) => ({ t: t0 + i * 66, p: body({ hipDeg: 175, kneeDeg: 178 }) }));
  const down = [170, 150, 130, 110, 90, 75, 70];
  const up = [75, 90, 110, 130, 150, 168];

  it('lowering the bar after a lockout is not a hitch', () => {
    const f = [...pull(up, 0), ...hold(400), ...pull(down, 1000), ...pull(up, 1500), ...hold(1900)];
    const r = judgeDeadlift(f, D, { start: 0, end: 3000 });
    expect(r.reps.map(x => x.call)).toEqual([{ light: 'white' }, { light: 'white' }]);
  });
  it('a dip of more than 8° on the way up is a hitch', () => {
    const f = [...pull([75, 90, 110, 120, 110, 125, 150, 168], 0), ...hold(600)];
    const r = judgeDeadlift(f, D, { start: 0, end: 2000 });
    expect(r.reps[0].call).toEqual({ light: 'close', reason: 'hitch' });
  });
});
