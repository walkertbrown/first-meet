// Plan piece 3, `frame-check` (rules in 3.4, words in 5.2).
import { describe, expect, it } from 'vitest';
import { FrameCheck, L, RULES, TryALift, checkSpot, type Frame, type Pt } from '../../web/lib/judge';

const D = { w: 720, h: 1280 };

/** A woman standing side-on, left side to the phone, whole body in frame. */
function standing(): Pt[] {
  const p: Pt[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0] as Pt);
  const set = (i: number, x: number, y: number, v: number) => { p[i] = [x, y, v]; };
  set(L.nose, 0.53, 0.12, 0.99); set(L.leftEar, 0.5, 0.12, 0.99); set(L.rightEar, 0.5, 0.12, 0.3);
  set(L.leftShoulder, 0.5, 0.25, 0.99); set(L.rightShoulder, 0.51, 0.25, 0.4);
  set(L.leftHip, 0.5, 0.5, 0.99); set(L.rightHip, 0.51, 0.5, 0.4);
  set(L.leftKnee, 0.52, 0.7, 0.99); set(L.rightKnee, 0.53, 0.7, 0.4);
  set(L.leftAnkle, 0.5, 0.9, 0.99); set(L.rightAnkle, 0.51, 0.9, 0.4);
  set(L.leftHeel, 0.48, 0.92, 0.99); set(L.rightHeel, 0.49, 0.92, 0.4);
  return p;
}
const edit = (f: (p: Pt[]) => void) => { const p = standing(); f(p); return p; };

const FEET = 'Step back until we can see your feet.';
const HEAD = 'Step back until we can see your head.';
const TURN = 'Turn so your side faces the phone.';
const LIGHT = "Move into the light. We can't see your knees.";

const feetOut = (p: Pt[]) => { p[L.leftAnkle][1] = 0.99; p[L.leftHeel][1] = 0.995; };
const headOut = (p: Pt[]) => { for (const i of [L.nose, L.leftEar, L.rightEar]) p[i][1] = 0.01; };
const facing = (p: Pt[]) => { p[L.rightShoulder][0] = 0.7; };
const kneesDark = (p: Pt[]) => { p[L.leftKnee][2] = 0.2; p[L.rightKnee][2] = 0.2; };
const hipsDark = (p: Pt[]) => { p[L.leftHip][2] = 0.2; p[L.rightHip][2] = 0.2; };

describe('the four segments light separately', () => {
  it('all four are lit when she is in her spot', () => {
    expect(checkSpot(standing(), D)).toEqual({ parts: { head: true, hips: true, knees: true, feet: true }, sideOn: true, ok: true, line: null });
  });

  it.each([
    ['head', headOut],
    ['hips', hipsDark],
    ['knees', kneesDark],
    ['feet', feetOut],
  ] as const)('only %s goes dark when only it is not seen', (part, f) => {
    const s = checkSpot(edit(f), D);
    expect(s.parts).toEqual({ head: true, hips: true, knees: true, feet: true, [part]: false });
    expect(s.ok).toBe(false);
  });

  it('facing the phone lights all four but still fails', () => {
    const s = checkSpot(edit(facing), D);
    expect(s.parts).toEqual({ head: true, hips: true, knees: true, feet: true });
    expect(s.sideOn).toBe(false);
    expect(s.ok).toBe(false);
  });

  it('nothing seen lights nothing', () => {
    expect(checkSpot(null, D).parts).toEqual({ head: false, hips: false, knees: false, feet: false });
  });
});

describe('each failing case shows its exact line from 5.2', () => {
  it.each([
    ['feet out of frame', feetOut, FEET],
    ['head out of frame', headOut, HEAD],
    ['facing the phone', facing, TURN],
    ['knees too dark to see', kneesDark, LIGHT],
    ['hips too dark to see', hipsDark, LIGHT],
  ] as const)('%s', (_, f, line) => {
    expect(checkSpot(edit(f), D).line).toBe(line);
  });

  it('a point less than 3% from the edge counts as out, however visible', () => {
    expect(checkSpot(edit(p => { p[L.leftHeel][1] = 0.975; }), D).line).toBe(FEET);
    expect(checkSpot(edit(p => { p[L.leftHeel][1] = 0.965; }), D).line).toBeNull();
  });

  it('one line at a time, the first that applies', () => {
    expect(checkSpot(edit(p => { feetOut(p); headOut(p); facing(p); kneesDark(p); }), D).line).toBe(FEET);
    expect(checkSpot(edit(p => { headOut(p); facing(p); kneesDark(p); }), D).line).toBe(HEAD);
    expect(checkSpot(edit(p => { facing(p); kneesDark(p); }), D).line).toBe(TURN);
    expect(checkSpot(null, D).line).toBe(FEET);
  });
});

describe('it never starts an attempt until it passes', () => {
  const run = (frames: Frame[]) => {
    const tal = new TryALift(D);
    const evs = frames.flatMap(f => tal.feed(f));
    return { tal, types: evs.map(e => e.type) };
  };
  const every = (from: number, to: number, p: Pt[] | null, step = 66): Frame[] =>
    Array.from({ length: Math.floor((to - from) / step) }, (_, i) => ({ t: from + i * step, p }));

  it.each([
    ['feet out', feetOut], ['head out', headOut], ['facing the phone', facing], ['knees dark', kneesDark],
  ] as const)('%s for 30 s: no "Good spot.", no "Squat!"', (_, f) => {
    const { tal, types } = run(every(0, 30_000, edit(f)));
    expect(tal.phase).toBe('spot');
    expect(types.filter(t => t !== 'spot')).toEqual([]);
    expect(tal.squatAt).toBeNull();
  });

  it(`the spot must hold ${RULES.frameCheck.holdMs} ms straight; a slip starts the count again`, () => {
    const fc = new FrameCheck(D);
    const ok = standing(), bad = edit(facing);
    for (let t = 0; t < RULES.frameCheck.holdMs - 100; t += 66) fc.feed({ t, p: ok });
    expect(fc.passed).toBe(false);
    fc.feed({ t: RULES.frameCheck.holdMs - 50, p: bad });
    const restart = RULES.frameCheck.holdMs;
    for (let t = restart; t < restart + RULES.frameCheck.holdMs - 100; t += 66) fc.feed({ t, p: ok });
    expect(fc.passed).toBe(false);
    fc.feed({ t: restart + RULES.frameCheck.holdMs, p: ok });
    expect(fc.passed).toBe(true);
  });

  it('"Good spot." comes only once the check passes, and "Squat!" only after it', () => {
    const tal = new TryALift(D);
    const seen: { type: string; t: number }[] = [];
    for (const f of [...every(0, 5000, edit(headOut)), ...every(5000, 15_000, standing())]) seen.push(...tal.feed(f));
    const goodSpot = seen.find(e => e.type === 'good-spot')!;
    expect(goodSpot.t).toBeGreaterThanOrEqual(5000 + RULES.frameCheck.holdMs);
    const squat = seen.find(e => e.type === 'squat');
    expect(squat, '"Squat!" comes once she stands still in a good spot').toBeTruthy();
    expect(squat!.t).toBeGreaterThan(goodSpot.t);
  });
});
