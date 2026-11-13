// The overhead press (Home), filmed front-on (plan 3.4c, #home-press A; 3.8a; 5.34): the commands
// the phone calls live, and the call the server makes from the recording. Both arms are measured.
import { type Dims, type Frame, type Pt, type XY, L, angle, dist, mid, nearSide, px, torsoLength } from './pose';
import { RULES, type Rules } from './rules';
import { lowVisibilityShare, type AttemptResult, type Call, type RepResult, type Window } from './call';
import { median, steady } from './press';

const ARM_POINTS = [L.leftShoulder, L.leftElbow, L.leftWrist, L.rightShoulder, L.rightElbow, L.rightWrist];

/** One front-on frame's measures: both arms, both wrists, and the nose. */
export function overheadMeasure(p: Pt[], d: Dims, rules: Rules = RULES) {
  const ls = px(p, L.leftShoulder, d), le = px(p, L.leftElbow, d), lw = px(p, L.leftWrist, d);
  const rs = px(p, L.rightShoulder, d), re = px(p, L.rightElbow, d), rw = px(p, L.rightWrist, d);
  // the nose, or the middle of the ears when the nose isn't seen
  const nose = px(p, L.nose, d);
  const head = nose.v >= rules.visibilityMin ? nose : mid(px(p, L.leftEar, d), px(p, L.rightEar, d));
  const lDeg = angle(ls, le, lw), rDeg = angle(rs, re, rw);
  return {
    lw, rw, lDeg, rDeg, headY: head.y,
    /** The lower of the two elbow angles: what a hold is judged on. */
    bothDeg: Math.min(lDeg, rDeg),
    /** The higher of the two: both elbows are under 100° at "Start!" only when this is. */
    topDeg: Math.max(lDeg, rDeg),
    /** Her arm, shoulder to elbow plus elbow to wrist, the two arms' mean, in pixels. */
    arm: (dist(ls, le) + dist(le, lw) + dist(rs, re) + dist(re, rw)) / 2 || 1,
    /** Both wrists above the nose. */
    wristsUp: Math.max(lw.y, rw.y) < head.y,
    shoulderOverTorso: Math.abs(ls.x - rs.x) / torsoLength(p, d),
  };
}
export type OverheadMeasures = ReturnType<typeof overheadMeasure>;
type Sample = { t: number; m: OverheadMeasures };

/** How far the two wrists moved over these frames (the larger of the two), in arm lengths. */
function moved(list: Sample[], arm: number): number {
  const one = (pick: (m: OverheadMeasures) => XY) => {
    const xs = steady(list.map(s => pick(s.m).x)), ys = steady(list.map(s => pick(s.m).y));
    return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / arm;
  };
  return Math.max(one(m => m.lw), one(m => m.rw));
}

/** The wrists' movement over the last `ms`, or null until there's that much history. */
function recentRange(hist: Sample[], now: number, ms: number, arm: number): number | null {
  if (!hist.length || now - hist[0].t < ms) return null;
  let from = hist.length - 1;
  while (from > 0 && now - hist[from].t < ms) from--;
  const recent = hist.slice(from);
  return recent.length < 2 ? null : moved(recent, arm);
}

/** At her shoulders: both elbows under 100°, both wrists lower than the nose plus 0.2 of her arm. */
const racked = (m: OverheadMeasures, r: Rules['overhead']) =>
  m.topDeg < r.startElbowMaxDeg && Math.min(m.lw.y, m.rw.y) > m.headY - r.startWristOverNoseArm * m.arm;

/** Where both wrists sat at "Start!", and her arm then: a rep is measured from these. */
export type Base = { ly: number; ry: number; arm: number };
/** The smaller of the two wrists' rise over its "Start!" height, in arm lengths: a rep starts when both are up. */
const rise = (m: OverheadMeasures, b: Base) => Math.min(b.ly - m.lw.y, b.ry - m.rw.y) / b.arm;
/** The larger of the two: both wrists are back only when this is within the back line. */
const riseMax = (m: OverheadMeasures, b: Base) => Math.max(b.ly - m.lw.y, b.ry - m.rw.y) / b.arm;

/** The base from the frames of the "Start!" hold. */
const baseOf = (hold: Sample[]): Base => ({ ly: median(hold.map(x => x.m.lw.y)), ry: median(hold.map(x => x.m.rw.y)), arm: median(hold.map(x => x.m.arm)) });

export type OverheadCommand = { cmd: 'start'; t: number } | { cmd: 'rep'; t: number; k: number } | { cmd: 'rack'; t: number; noRep?: boolean };

/**
 * The overhead press's commands (3.4c):
 * - "Start!" when both elbows are under 100°, both wrists lower than the nose plus 0.2 of her arm,
 *   and both wrists still (under 7% of her arm) for 0.3 s;
 * - no "Press!";
 * - a rep starts when both wrists rise 0.3 arm above their own "Start!" heights, and ends, and is
 *   counted, when both are back within 0.15 arm of them: a bent rep is counted like any other;
 * - "Rack!" after the declared reps, 8 s after a rep with no new one (3.8a), or 20 s after
 *   "Start!" with no rep.
 */
export class OverheadCaller {
  state: 'waiting' | 'lifting' | 'done' = 'waiting';
  /** A rep is under way: both wrists went up, and aren't back yet. */
  inRep = false;
  startAt: number | null = null;
  rackAt: number | null = null;
  repsDone = 0;
  base: Base | null = null;
  private lastRepAt: number | null = null;
  private queue: OverheadCommand[] = [];
  private hist: Sample[] = [];
  private rises: number[] = [];
  private backs: number[] = [];
  private reps: number;
  constructor(private d: Dims, private rules: Rules = RULES, opts: { reps?: number } = {}) {
    this.reps = opts.reps ?? 1;
  }

  feed(f: Frame): OverheadCommand | null {
    if (this.queue.length) return this.queue.shift()!;
    const r = this.rules.overhead;
    if (this.state === 'done') return null;
    if (this.state === 'lifting') {
      const since = this.lastRepAt ?? this.startAt!;
      if (f.t - since >= (this.lastRepAt !== null ? r.homeNoRepMs : r.noRepMs)) {
        this.state = 'done'; this.rackAt = f.t;
        return { cmd: 'rack', t: f.t, noRep: this.repsDone === 0 };
      }
    }
    if (!f.p) { this.hist = []; return null; }
    const m = overheadMeasure(f.p, this.d, this.rules);
    this.hist.push({ t: f.t, m });
    while (this.hist.length && f.t - this.hist[0].t > 2000) this.hist.shift();

    if (this.state === 'waiting') {
      const recent = this.hist.filter(x => f.t - x.t <= r.startStillMs);
      const arm = median(recent.map(x => x.m.arm));
      const still = recentRange(this.hist, f.t, r.startStillMs, arm);
      if (still !== null && still < r.stillMaxArm && recent.every(x => racked(x.m, r))) {
        this.state = 'lifting'; this.startAt = f.t; this.base = baseOf(recent);
        return { cmd: 'start', t: f.t };
      }
      return null;
    }
    // steadied over the last three frames, as the judge steadies
    this.rises.push(rise(m, this.base!)); this.backs.push(riseMax(m, this.base!));
    if (this.rises.length > 3) { this.rises.shift(); this.backs.shift(); }
    const up = median(this.rises), back = median(this.backs);
    if (!this.inRep && up >= r.repUpArm) this.inRep = true;
    else if (this.inRep && back <= r.repBackArm) {
      this.inRep = false; this.repsDone++; this.lastRepAt = f.t;
      if (this.repsDone >= this.reps) {
        this.state = 'done'; this.rackAt = f.t;
        this.queue.push({ cmd: 'rack', t: f.t });
      }
      return { cmd: 'rep', t: f.t, k: this.repsDone };
    }
    return null;
  }
}

type Judged = Sample & { p: Pt[] };
type Hold = { deg: number; first: Judged };

/**
 * The best 0.4 s hold in one rep (3.4c): both wrists above the nose and moving less than 12% of
 * her arm, scored by the lowest of its lower-elbow angles (steadied over three frames). Returns
 * the first hold at the lockout line or over, from its first frame over the line with the wrists
 * up; else the best.
 */
function bestHold(list: Judged[], r: Rules['overhead'], arm: number): Hold | undefined {
  const deg = steady(list.map(s => s.m.bothDeg));
  let best: Hold | undefined;
  let lockFrom = -1, upFrom = -1;
  for (let i = 0, j = 0; i < list.length; i++) {
    while (j < i && list[i].t - list[j + 1].t >= r.lockoutStillMs) j++;
    if (deg[i] >= r.lockoutElbowMinDeg) { if (lockFrom < 0) lockFrom = i; } else lockFrom = -1;
    if (list[i].m.wristsUp) { if (upFrom < 0) upFrom = i; } else upFrom = -1;
    if (list[i].t - list[j].t < r.lockoutStillMs) continue;
    if (upFrom < 0 || upFrom > j) continue;
    if (moved(list.slice(j, i + 1), arm) >= r.lockoutStillMaxArm) continue;
    const low = Math.min(...deg.slice(j, i + 1));
    if (low >= r.lockoutElbowMinDeg) return { deg: low, first: list[Math.max(lockFrom, upFrom)] };
    if (!best || low > best.deg) best = { deg: low, first: list[j] };
  }
  return best;
}

/** On the judged frame: both shoulders, elbows and wrists, and the nose, pass the frame check's numbers (3.4c). */
export function overheadFrameSeen(p: Pt[], rules: Rules = RULES): boolean {
  const m = rules.frameCheck.edgeMargin;
  return [...ARM_POINTS, L.nose].every(i => {
    const [x, y, v] = p[i];
    return v >= rules.visibilityMin && x >= m && x <= 1 - m && y >= m && y <= 1 - m;
  });
}

export type OverheadRep = RepResult & {
  /** The judged hold's lower elbow angle, or the highest the arms got with no hold. */
  lockoutElbowDeg: number;
  /** Whether there was a 0.4 s hold at the top at all. */
  held: boolean;
};

const VISIBILITY: Call = { light: 'close', reason: 'visibility' };

/**
 * The overhead press call (3.4c, A), from the recording. The reps are found as the phone finds
 * them, from the wrists' rise over their "Start!" heights, between "Start!" and "Rack!", and
 * every rep is judged, even after a red, on its best 0.4 s hold:
 * - white at 145° or more;
 * - close `borderline_lockout` at 135–145°;
 * - red `no_lockout` under 135°, or with no 0.4 s hold at all;
 * - close `visibility` when a shoulder, elbow or wrist, or the nose, isn't seen on the judged frame.
 * The set: any red rep is a no lift, any close rep goes to a referee (3.8a, in attempt.ts).
 */
export function judgeOverhead(all: Frame[], d: Dims, w: Window, rules: Rules = RULES): AttemptResult & { reps: OverheadRep[] } {
  const r = rules.overhead;
  const frames = all.filter(f => f.t >= w.start && f.t <= w.end);
  const side = nearSide(frames);
  const lowVisShare = lowVisibilityShare(frames, side, rules);
  const toSample = (f: Frame): Judged => ({ t: f.t, p: f.p!, m: overheadMeasure(f.p!, d, rules) });
  const samples = frames.filter(f => f.p).map(toSample);
  // the base is the phone's: the wrists over the "Start!" hold, just before "Start!"
  const hold = all.filter(f => f.p && f.t >= w.start - r.startStillMs && f.t <= w.start).map(toSample);
  const base = baseOf(hold.length ? hold : samples.slice(0, 5));
  const up = steady(samples.map(s => rise(s.m, base)));
  const back = steady(samples.map(s => riseMax(s.m, base)));
  const segs: { idx: number[]; ended: boolean }[] = [];
  let cur: number[] | null = null;
  samples.forEach((_, i) => {
    if (!cur && up[i] >= r.repUpArm) cur = [];
    if (cur) {
      if (back[i] <= r.repBackArm) { segs.push({ idx: cur, ended: true }); cur = null; } else cur.push(i);
    }
  });
  if (cur && (cur as number[]).length) segs.push({ idx: cur, ended: false });

  const reps: OverheadRep[] = segs.filter(s => s.idx.length).map(({ idx, ended }) => {
    const rep = idx.map(i => samples[i]);
    const lock = bestHold(rep, r, base.arm);
    // with no hold, the frame where both wrists got highest
    const highest = rep.reduce((x, y) => (Math.max(y.m.lw.y, y.m.rw.y) < Math.max(x.m.lw.y, x.m.rw.y) ? y : x));
    const judged = lock ? lock.first : highest;
    const deg = lock ? lock.deg : highest.m.bothDeg;
    const call: Call = !overheadFrameSeen(judged.p, rules) ? VISIBILITY
      : !lock || deg < r.borderlineElbowMinDeg ? { light: 'red', reason: 'no_lockout' }
      : deg < r.lockoutElbowMinDeg ? { light: 'close', reason: 'borderline_lockout' }
      : { light: 'white' };
    return { call, startMs: rep[0].t, judgedFrameMs: judged.t, ...(ended && { endMs: rep.at(-1)!.t }), lockoutElbowDeg: deg, held: !!lock };
  });

  let call: Call;
  if (lowVisShare > rules.visibilityCloseCallShare) call = VISIBILITY;
  else call = reps.find(x => x.call.light === 'red')?.call ?? reps.find(x => x.call.light === 'close')?.call ?? reps[0]?.call ?? { light: 'red', reason: 'no_lockout' };
  const shown = reps.find(x => x.call.light === 'red') ?? reps.find(x => x.call.light === 'close') ?? reps[0];
  return { call, judgedFrameMs: shown?.judgedFrameMs ?? null, reps, side, lowVisShare, noRep: !reps.length };
}
