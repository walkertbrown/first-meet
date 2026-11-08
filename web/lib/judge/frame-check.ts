// The frame check (plan 3.4; words in 5.2). It must pass for 1 second straight
// before any attempt starts.
import { type Dims, type Frame, type Pt, L, SIDES, nearSide, px, mid, torsoLength } from './pose';
import { RULES, type Rules } from './rules';

export type Part = 'head' | 'hips' | 'knees' | 'feet';
export type SpotLine =
  | 'Step back until we can see your feet.'
  | 'Step back until we can see your head.'
  | 'Turn so your side faces the phone.'
  | "Move into the light. We can't see your knees.";

export type Spot = {
  parts: Record<Part, boolean>;
  sideOn: boolean;
  ok: boolean;
  /** The first line that applies, or null when the spot is right. */
  line: SpotLine | null;
};

const inside = (x: number, y: number, m: number) => x >= m && x <= 1 - m && y >= m && y <= 1 - m;

export function checkSpot(p: Pt[] | null, d: Dims, rules: Rules = RULES): Spot {
  const vmin = rules.visibilityMin, m = rules.frameCheck.edgeMargin;
  if (!p) {
    return { parts: { head: false, hips: false, knees: false, feet: false }, sideOn: false, ok: false, line: 'Step back until we can see your feet.' };
  }
  const s = SIDES[nearSide({ t: 0, p })];
  const seen = (i: number) => p[i][2] >= vmin;
  const seenInside = (i: number) => seen(i) && inside(p[i][0], p[i][1], m);
  const head = [L.nose, L.leftEar, L.rightEar].some(seenInside);
  const hips = seen(s.hip);
  const knees = seen(s.knee);
  const feet = seenInside(s.ankle) && seenInside(s.heel);
  const shoulderGap = Math.abs(px(p, L.leftShoulder, d).x - px(p, L.rightShoulder, d).x);
  const sideOn = shoulderGap < rules.frameCheck.sideOnMaxShoulderOverTorso * torsoLength(p, d);
  const parts = { head, hips, knees, feet };
  let line: SpotLine | null = null;
  if (!feet) line = 'Step back until we can see your feet.';
  else if (!head) line = 'Step back until we can see your head.';
  else if (!sideOn) line = 'Turn so your side faces the phone.';
  else if (!hips || !knees) line = "Move into the light. We can't see your knees.";
  return { parts, sideOn, ok: line === null, line };
}

/** Holds the spot for 1 s straight. Feed it every frame, in time order. */
export class FrameCheck {
  private since: number | null = null;
  passed = false;
  last: Spot | null = null;
  constructor(private d: Dims, private rules: Rules = RULES) {}

  feed(f: Frame): Spot {
    const spot = checkSpot(f.p, this.d, this.rules);
    this.last = spot;
    if (!spot.ok) { this.since = null; return spot; }
    if (this.since === null) this.since = f.t;
    if (f.t - this.since >= this.rules.frameCheck.holdMs) this.passed = true;
    return spot;
  }
}

export type SpotCheck = Part | 'sideOn';

/**
 * Runs the frame check over a clip: did it ever pass, which line showed most, and
 * the share of frames on which each part of the check failed.
 */
export function frameCheckClip(frames: Frame[], d: Dims, rules: Rules = RULES) {
  const fc = new FrameCheck(d, rules);
  const lines = new Map<string, number>();
  const fails: Record<SpotCheck, number> = { head: 0, hips: 0, knees: 0, feet: 0, sideOn: 0 };
  let passedAt: number | null = null;
  for (const f of frames) {
    const s = fc.feed(f);
    if (s.line) lines.set(s.line, (lines.get(s.line) ?? 0) + 1);
    for (const k of ['head', 'hips', 'knees', 'feet'] as const) if (!s.parts[k]) fails[k]++;
    if (!s.sideOn) fails.sideOn++;
    if (fc.passed && passedAt === null) passedAt = f.t;
  }
  const commonLine = [...lines.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const n = frames.length || 1;
  const failShare = Object.fromEntries(Object.entries(fails).map(([k, v]) => [k, v / n])) as Record<SpotCheck, number>;
  return { passed: passedAt !== null, passedAt, commonLine, failShare };
}

export { mid };
