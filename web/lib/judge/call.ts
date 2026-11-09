// The call (plan 3.4): from the frames inside the attempt window, decide
// white, red (with a reason), or a close call (with a reason only referees see).
import { type Dims, type Frame, type Pt, type Side, type SidePts, measure, nearSide, SIDES } from './pose';
import { RULES, type Rules } from './rules';

export type RedReason = 'depth' | 'no_lockout' | 'no_pause';
export type CloseReason = 'borderline_depth' | 'visibility' | 'short_pause' | 'hitch';
export type Call =
  | { light: 'white' }
  | { light: 'red'; reason: RedReason }
  | { light: 'close'; reason: CloseReason };

export type RepResult = {
  call: Call;
  /** When the rep began: the knee going under 140° (squat), the bar starting up (deadlift). */
  startMs: number;
  /** The frame the call is about: the lowest frame (squat), the first lockout frame (deadlift). */
  judgedFrameMs: number;
  /** When the rep was over: standing back up (squat), the lockout held (deadlift). Absent if it never was. */
  endMs?: number;
  depth?: number;
  bottomKneeDeg?: number;
  lockoutHipDeg?: number;
  lockoutKneeDeg?: number;
};

export type AttemptResult = {
  /** The attempt's one call: its first rep's, or the visibility close call. */
  call: Call;
  judgedFrameMs: number | null;
  reps: RepResult[];
  side: Side;
  /** The share of window frames where a near shoulder, hip, knee or ankle was under 0.5. */
  lowVisShare: number;
  /** True when no rep was seen at all (Try a lift: "We didn't see a squat."). */
  noRep: boolean;
};

export type Window = { start: number; end: number };

const inWindow = (frames: Frame[], w: Window) => frames.filter(f => f.t >= w.start && f.t <= w.end);

export function lowVisibilityShare(frames: Frame[], side: Side, rules: Rules = RULES): number {
  if (!frames.length) return 1;
  const s = SIDES[side];
  let low = 0;
  for (const f of frames) {
    if (!f.p || [s.shoulder, s.hip, s.knee, s.ankle].some(i => f.p![i][2] < rules.visibilityMin)) low++;
  }
  return low / frames.length;
}

/**
 * The points each call is measured from (3.4, "Visibility on the judged frame").
 * The press points are the plan's guess; phase 2's press test checks them.
 */
export const JUDGED_POINTS = {
  squat: ['hip', 'knee', 'ankle'],
  deadlift: ['hip', 'knee', 'ankle'],
  press: ['shoulder', 'elbow', 'wrist'],
} as const satisfies Record<string, readonly (keyof SidePts)[]>;

/**
 * True when every point the call is measured from is seen (visibility at least 0.5)
 * and sits inside the frame by the frame check's margin. When it's false the rep
 * is a close call `visibility`, never a white.
 */
export function judgedFrameSeen(p: Pt[], side: Side, points: readonly (keyof SidePts)[], rules: Rules = RULES): boolean {
  const s = SIDES[side], m = rules.frameCheck.edgeMargin;
  return points.every(k => {
    const [x, y, v] = p[s[k]];
    return v >= rules.visibilityMin && x >= m && x <= 1 - m && y >= m && y <= 1 - m;
  });
}

const VISIBILITY: Call = { light: 'close', reason: 'visibility' };

function depthCall(depth: number, stood: boolean, rules: Rules): Call {
  const r = rules.squat;
  if (depth < r.redDepthMax) return { light: 'red', reason: 'depth' };
  if (depth <= r.whiteDepthMin) return { light: 'close', reason: 'borderline_depth' };
  if (!stood) return { light: 'red', reason: 'no_lockout' };
  return { light: 'white' };
}

/**
 * Squat and goblet squat. Reps inside the window are split on the knee going
 * below 140° and back above 160°; each rep's call comes from depth at its lowest frame.
 */
export function judgeSquat(all: Frame[], d: Dims, w: Window, rules: Rules = RULES): AttemptResult {
  const frames = inWindow(all, w);
  const side = nearSide(frames);
  const lowVisShare = lowVisibilityShare(frames, side, rules);
  const r = rules.squat;
  const reps: RepResult[] = [];
  const squatRep = (b: NonNullable<typeof best>, stoodAt: number | null): RepResult => ({
    call: judgedFrameSeen(b.p, side, JUDGED_POINTS.squat, rules) ? depthCall(b.depth, stoodAt !== null, rules) : VISIBILITY,
    startMs, judgedFrameMs: b.t, ...(stoodAt !== null && { endMs: stoodAt }), depth: b.depth, bottomKneeDeg: b.knee,
  });
  let down = false;
  let best: { t: number; depth: number; knee: number; p: Pt[] } | null = null;
  let startMs = 0;
  for (const f of frames) {
    if (!f.p) continue;
    const m = measure(f.p, d, side);
    if (!down && m.knee_deg < r.downKneeMaxDeg) { down = true; startMs = f.t; best = { t: f.t, depth: m.depth, knee: m.knee_deg, p: f.p }; }
    if (down && best) {
      if (m.depth > best.depth) best = { t: f.t, depth: m.depth, knee: m.knee_deg, p: f.p };
      if (m.knee_deg > r.standKneeMinDeg) {
        reps.push(squatRep(best, f.t));
        down = false; best = null;
      }
    }
  }
  // went down but never stood back up before the window closed
  if (down && best) reps.push(squatRep(best, null));

  let call: Call;
  if (lowVisShare > rules.visibilityCloseCallShare) call = VISIBILITY;
  else if (!reps.length) call = { light: 'red', reason: 'no_lockout' };
  else call = reps[0].call;
  return { call, judgedFrameMs: reps[0]?.judgedFrameMs ?? null, reps, side, lowVisShare, noRep: !reps.length };
}

/**
 * Deadlift. A lockout is both the hip angle (shoulder-hip-knee) and the knee angle
 * over 165° for 0.4 s. After a lockout, the next rep starts once the hip angle goes
 * back under 150°. A hitch (the hip angle going down more than 8° on the way up) is a close call.
 */
export function judgeDeadlift(all: Frame[], d: Dims, w: Window, rules: Rules = RULES): AttemptResult {
  const frames = inWindow(all, w);
  const side = nearSide(frames);
  const lowVisShare = lowVisibilityShare(frames, side, rules);
  const r = rules.deadlift;
  const reps: RepResult[] = [];
  let lockSince: number | null = null, lockFirst: { t: number; hip: number; knee: number; p: Pt[] } | null = null;
  let armed = true;
  let startMs = frames[0]?.t ?? w.start;
  let peakHip = -Infinity, lowHip = Infinity, hitch = false;
  for (const f of frames) {
    if (!f.p) continue;
    const m = measure(f.p, d, side);
    if (!armed) {
      if (m.hip_deg < r.rearmBelowDeg) { armed = true; startMs = f.t; peakHip = m.hip_deg; lowHip = m.hip_deg; hitch = false; }
      continue;
    }
    // On the way up the hip angle should only open; a drop of more than 8° is a hitch.
    // Lowering the bar after a lockout isn't the way up: while the hip angle keeps
    // reaching new lows she is still going down, so the count starts again from there.
    if (m.hip_deg < lowHip) { lowHip = m.hip_deg; peakHip = m.hip_deg; hitch = false; }
    else if (m.hip_deg > peakHip) peakHip = m.hip_deg;
    else if (peakHip - m.hip_deg > r.hitchDropDeg && peakHip < r.lockoutMinDeg) hitch = true;
    if (m.hip_deg > r.lockoutMinDeg && m.knee_deg > r.lockoutMinDeg) {
      if (lockSince === null) { lockSince = f.t; lockFirst = { t: f.t, hip: m.hip_deg, knee: m.knee_deg, p: f.p }; }
      if (f.t - lockSince >= r.lockoutHoldMs && lockFirst) {
        const call: Call = !judgedFrameSeen(lockFirst.p, side, JUDGED_POINTS.deadlift, rules) ? VISIBILITY
          : hitch ? { light: 'close', reason: 'hitch' } : { light: 'white' };
        reps.push({ call, startMs, judgedFrameMs: lockFirst.t, endMs: f.t, lockoutHipDeg: lockFirst.hip, lockoutKneeDeg: lockFirst.knee });
        armed = false; lockSince = null; lockFirst = null;
      }
    } else { lockSince = null; lockFirst = null; }
  }
  let call: Call;
  if (lowVisShare > rules.visibilityCloseCallShare) call = VISIBILITY;
  else if (!reps.length) call = { light: 'red', reason: 'no_lockout' };
  else call = reps[0].call;
  return { call, judgedFrameMs: reps[0]?.judgedFrameMs ?? null, reps, side, lowVisShare, noRep: !reps.length };
}
