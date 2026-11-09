// The frame check (plan 3.4; words in 5.2). It must pass for 1 second straight
// before any attempt starts.
import { type Dims, type Frame, type Pt, L, SIDES, dist, nearSide, px, mid, torsoLength } from './pose';
import { RULES, type Rules } from './rules';

export type Part = 'head' | 'hips' | 'knees' | 'feet';
export type SpotLine =
  | 'Step back until we can see your feet.'
  | 'Step back until we can see your head.'
  | 'Turn so your side faces the phone.'
  | "Move into the light. We can't see your knees."
  // the Home overhead press, filmed front-on (3.4c, 5.34)
  | 'Turn to face the phone.'
  | "Step back so there's room above your head for your arms.";

/**
 * Which way she stands to the phone: side-on for every lift but the Home overhead press, which is
 * filmed front-on (3.4c).
 */
export type SpotView = 'side' | 'front';

export type Spot = {
  parts: Record<Part, boolean>;
  sideOn: boolean;
  /** Front-on only: the shoulders 0.5 × the torso apart, and both arms seen (3.4c). */
  facing: boolean;
  /** Front-on only: room above the higher shoulder for 1.1 × her arm; part of "HEAD" (3.4). */
  room: boolean;
  ok: boolean;
  /** The first line that applies, or null when the spot is right. */
  line: SpotLine | null;
};

const inside = (x: number, y: number, m: number) => x >= m && x <= 1 - m && y >= m && y <= 1 - m;

const ARMS = [[L.leftShoulder, L.leftElbow, L.leftWrist], [L.rightShoulder, L.rightElbow, L.rightWrist]] as const;

export function checkSpot(p: Pt[] | null, d: Dims, rules: Rules = RULES, view: SpotView = 'side'): Spot {
  const vmin = rules.visibilityMin, m = rules.frameCheck.edgeMargin, fc = rules.frameCheck;
  if (!p) {
    return { parts: { head: false, hips: false, knees: false, feet: false }, sideOn: false, facing: false, room: false, ok: false, line: 'Step back until we can see your feet.' };
  }
  const s = SIDES[nearSide({ t: 0, p })];
  const seen = (i: number) => p[i][2] >= vmin;
  const seenInside = (i: number) => seen(i) && inside(p[i][0], p[i][1], m);
  const headSeen = [L.nose, L.leftEar, L.rightEar].some(seenInside);
  const hips = seen(s.hip);
  const knees = seen(s.knee);
  const feet = seenInside(s.ankle) && seenInside(s.heel);
  const shoulderGap = Math.abs(px(p, L.leftShoulder, d).x - px(p, L.rightShoulder, d).x);
  const torso = torsoLength(p, d);
  const sideOn = shoulderGap < fc.sideOnMaxShoulderOverTorso * torso;
  // front-on: both shoulders, elbows and wrists seen, and the shoulders turned square to the phone
  const armsSeen = ARMS.every(a => a.every(seen));
  const facing = armsSeen && shoulderGap >= fc.frontOnMinShoulderOverTorso * torso;
  // room above: the higher shoulder down from the frame's top, against her arm (the two arms' mean,
  // shoulder to elbow plus elbow to wrist); only measured once both arms are seen
  const arm = ARMS.reduce((sum, [sh, el, wr]) => sum + dist(px(p, sh, d), px(p, el, d)) + dist(px(p, el, d), px(p, wr, d)), 0) / 2;
  const room = !armsSeen || Math.min(px(p, L.leftShoulder, d).y, px(p, L.rightShoulder, d).y) >= fc.roomAboveArm * arm;
  let line: SpotLine | null = null;
  if (view === 'front') {
    const parts = { head: headSeen && room, hips, knees, feet };
    if (!feet) line = 'Step back until we can see your feet.';
    else if (!headSeen) line = 'Step back until we can see your head.';
    else if (!room) line = "Step back so there's room above your head for your arms.";
    else if (!facing) line = 'Turn to face the phone.';
    else if (!hips || !knees) line = "Move into the light. We can't see your knees.";
    return { parts, sideOn, facing, room, ok: line === null, line };
  }
  const parts = { head: headSeen, hips, knees, feet };
  if (!feet) line = 'Step back until we can see your feet.';
  else if (!headSeen) line = 'Step back until we can see your head.';
  else if (!sideOn) line = 'Turn so your side faces the phone.';
  else if (!hips || !knees) line = "Move into the light. We can't see your knees.";
  return { parts, sideOn, facing, room: true, ok: line === null, line };
}

/** Holds the spot for 1 s straight. Feed it every frame, in time order. */
export class FrameCheck {
  private since: number | null = null;
  passed = false;
  last: Spot | null = null;
  constructor(private d: Dims, private rules: Rules = RULES, private view: SpotView = 'side') {}

  feed(f: Frame): Spot {
    const spot = checkSpot(f.p, this.d, this.rules, this.view);
    this.last = spot;
    if (!spot.ok) { this.since = null; return spot; }
    if (this.since === null) this.since = f.t;
    if (f.t - this.since >= this.rules.frameCheck.holdMs) this.passed = true;
    return spot;
  }
}

export type SpotCheck = Part | 'sideOn' | 'facing' | 'room';

/**
 * Runs the frame check over a clip: did it ever pass, which line showed most, and
 * the share of frames on which each part of the check failed.
 */
export function frameCheckClip(frames: Frame[], d: Dims, rules: Rules = RULES, view: SpotView = 'side') {
  const fc = new FrameCheck(d, rules, view);
  const lines = new Map<string, number>();
  const fails: Record<SpotCheck, number> = view === 'front' ? { head: 0, hips: 0, knees: 0, feet: 0, facing: 0, room: 0 } as Record<SpotCheck, number> : { head: 0, hips: 0, knees: 0, feet: 0, sideOn: 0 } as Record<SpotCheck, number>;
  let passedAt: number | null = null;
  for (const f of frames) {
    const s = fc.feed(f);
    if (s.line) lines.set(s.line, (lines.get(s.line) ?? 0) + 1);
    for (const k of ['head', 'hips', 'knees', 'feet'] as const) if (!s.parts[k]) fails[k]++;
    if (view === 'front') { if (!s.facing) fails.facing++; if (!s.room) fails.room++; } else if (!s.sideOn) fails.sideOn++;
    if (fc.passed && passedAt === null) passedAt = f.t;
  }
  const commonLine = [...lines.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const n = frames.length || 1;
  const failShare = Object.fromEntries(Object.entries(fails).map(([k, v]) => [k, v / n])) as Record<SpotCheck, number>;
  return { passed: passedAt !== null, passedAt, commonLine, failShare };
}

export { mid };
