// The overhead press (Home; plan 3.4, 3.7 and 5.34): the commands the phone calls live, and the
// call the server makes from the recording and the phone's rep ends.
import { type Dims, type Frame, type Pt, type Side, L, angle, nearSide, px, SIDES } from './pose';
import { RULES, type Rules } from './rules';
import { lowVisibilityShare, type AttemptResult, type Call, type RepResult, type Window } from './call';
import { median, moved, pointRange, pressMeasure, steady } from './press';

/** One frame's overhead measures: the press measures, plus where the wrists are against the nose. */
export function overheadMeasure(p: Pt[], d: Dims, side: Side, rules: Rules = RULES) {
  const m = pressMeasure(p, d, side, rules);
  const far = SIDES[side === 'left' ? 'right' : 'left'];
  // the nose, or the near ear when the nose is turned away
  const nose = px(p, L.nose, d);
  const head = nose.v >= rules.visibilityMin ? nose : px(p, SIDES[side].ear, d);
  const owr = px(p, far.wrist, d);
  const farDeg = angle(px(p, far.shoulder, d), px(p, far.elbow, d), owr);
  // the lower wrist (larger y) of the two, or the near one when the far arm can't be seen
  const lowWristY = m.farSeen ? Math.max(m.wr.y, owr.y) : m.wr.y;
  const highWristY = m.farSeen ? Math.min(m.wr.y, owr.y) : m.wr.y;
  return {
    ...m,
    /** Both elbows: the higher of the two angles, or the near one when the far arm can't be seen. */
    topDeg: m.farSeen ? Math.max(m.elbowDeg, farDeg) : m.elbowDeg,
    /** How far the lower wrist is above the nose, in pixels (positive: both wrists above it). */
    upBy: head.y - lowWristY,
    /** Both wrists above the nose (the far one only when its arm can be seen). */
    wristsUp: lowWristY < head.y,
    /** Both wrists below the nose. */
    wristsDown: highWristY > head.y,
  };
}
export type OverheadMeasures = ReturnType<typeof overheadMeasure>;
type Sample = { t: number; m: OverheadMeasures };

const locked = (m: OverheadMeasures, r: Rules['overhead']) => m.bothDeg > r.lockoutElbowMinDeg && m.wristsUp;
const atShoulders = (m: OverheadMeasures, r: Rules['overhead']) => m.topDeg < r.startElbowMaxDeg && m.wristsDown;

export type OverheadCommand = { cmd: 'start'; t: number } | { cmd: 'rep'; t: number; k: number } | { cmd: 'rack'; t: number; noRep?: boolean };

/**
 * The overhead press (3.4):
 * - "Start!" with the dumbbells at her shoulders (both elbows below 100°, wrists below her nose),
 *   the wrists still (under 7% of her arm) for 0.5 s;
 * - no "Press!";
 * - a rep starts when the wrists rise above the nose, and ends when both elbows are over 165° with
 *   the wrists above the nose, held still for 0.4 s; the next can start once the wrists come back
 *   below the nose;
 * - "Rack!" after the declared reps, 8 s after a rep with no new one (3.8a), or 20 s after
 *   "Start!" with no rep.
 */
export class OverheadCaller {
  state: 'waiting' | 'lifting' | 'done' = 'waiting';
  /** Within the set: down (ready for a rep), up (a rep under way), or locked (that rep has ended). */
  phase: 'down' | 'up' | 'locked' = 'down';
  startAt: number | null = null;
  rackAt: number | null = null;
  repsDone = 0;
  /** The arm's length in pixels over the "Start!" hold: the unit for "still". */
  armRef: number | null = null;
  private lockSince: number | null = null;
  private lastRepAt: number | null = null;
  private queue: OverheadCommand[] = [];
  private hist: Sample[] = [];
  private side: Side | null = null;
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
    if (!f.p) { this.hist = []; this.lockSince = null; return null; }
    const side = this.side ?? nearSide(f);
    const m = overheadMeasure(f.p, this.d, side, this.rules);
    this.hist.push({ t: f.t, m });
    while (this.hist.length && f.t - this.hist[0].t > 2000) this.hist.shift();

    if (this.state === 'waiting') {
      const recent = this.hist.filter(x => f.t - x.t <= r.startStillMs);
      const arm = median(recent.map(x => x.m.arm));
      const still = pointRange(this.hist, f.t, r.startStillMs, x => x.wr, arm);
      if (still !== null && still < r.stillMaxArm && recent.every(x => atShoulders(x.m, r))) {
        this.state = 'lifting'; this.startAt = f.t; this.side = side; this.phase = 'down'; this.armRef = arm;
        return { cmd: 'start', t: f.t };
      }
      return null;
    }

    if (this.phase !== 'up') {
      if (this.phase === 'locked' && m.wristsDown) this.phase = 'down';
      else if (this.phase === 'down' && m.wristsUp) this.phase = 'up';
      if (this.phase !== 'up') return null;
    }
    if (!m.wristsUp) { this.phase = 'down'; this.lockSince = null; return null; }
    if (!locked(m, r)) { this.lockSince = null; return null; }
    if (this.lockSince === null) this.lockSince = f.t;
    const still = pointRange(this.hist, f.t, r.lockoutStillMs, x => x.wr, this.armRef!);
    if (f.t - this.lockSince >= r.lockoutStillMs && still !== null && still < r.stillMaxArm) {
      this.lockSince = null; this.phase = 'locked';
      this.repsDone++; this.lastRepAt = f.t;
      if (this.repsDone >= this.reps) {
        this.state = 'done'; this.rackAt = f.t;
        this.queue.push({ cmd: 'rack', t: f.t });
      }
      return { cmd: 'rep', t: f.t, k: this.repsDone };
    }
    return null;
  }
}

type Hold = { deg: number; first: Sample & { p: Pt[] } };

/**
 * The 0.4 s holds in one rep (the wrists above the nose and still), each scored by its lowest
 * elbow angle (both elbows, steadied over three frames). Returns the first hold over the lockout
 * line, or else the best hold.
 */
function bestHold(list: (Sample & { p: Pt[] })[], r: Rules['overhead'], arm: number): Hold | undefined {
  const deg = steady(list.map(s => s.m.bothDeg));
  let best: Hold | undefined;
  let lockFrom = -1;
  for (let i = 0, j = 0; i < list.length; i++) {
    while (j < i && list[i].t - list[j + 1].t >= r.lockoutStillMs) j++;
    if (deg[i] > r.lockoutElbowMinDeg) { if (lockFrom < 0) lockFrom = i; } else lockFrom = -1;
    if (list[i].t - list[j].t < r.lockoutStillMs) continue;
    if (moved(list.slice(j, i + 1), x => x.wr, arm) >= r.stillMaxArm) continue;
    const low = Math.min(...deg.slice(j, i + 1));
    // a lockout: the run over the line, held still; its first frame is the judged frame
    if (low > r.lockoutElbowMinDeg) return { deg: low, first: list[Math.min(lockFrom, j)] };
    if (!best || low > best.deg) best = { deg: low, first: list[j] };
  }
  return best;
}

export type OverheadRep = RepResult & { lockoutElbowDeg?: number };

const VISIBILITY: Call = { light: 'close', reason: 'visibility' };

/** The overhead press's points on the judged frame (3.4): the near shoulder, elbow and wrist, and the nose. */
export function overheadFrameSeen(p: Pt[], side: Side, rules: Rules = RULES): boolean {
  const s = SIDES[side], m = rules.frameCheck.edgeMargin;
  return [s.shoulder, s.elbow, s.wrist, L.nose].every(i => {
    const [x, y, v] = p[i];
    return v >= rules.visibilityMin && x >= m && x <= 1 - m && y >= m && y <= 1 - m;
  });
}

/**
 * The overhead press call (3.4), per declared rep. A rep is the wrists going above the nose and
 * back down (or to the rep's end: the phone's `rep_k`, or "Rack!"):
 * - white when both elbows are over 165° with the wrists above the nose, held still 0.4 s;
 * - close `borderline_lockout` when the best such hold is between 155° and 165°;
 * - red `no_lockout` when the wrists went above the nose and came back down without either, or
 *   when "Rack!" came before the rep locked out;
 * - close `visibility` if the near shoulder, elbow or wrist, or the nose, isn't seen on the judged
 *   frame.
 * The reps after the first red aren't judged: the attempt is already a no lift.
 */
export function judgeOverhead(all: Frame[], d: Dims, w: Window, repEnds: number[], declared: number, rules: Rules = RULES): AttemptResult & { reps: OverheadRep[] } {
  const r = rules.overhead;
  const frames = all.filter(f => f.t >= w.start && f.t <= w.end);
  const side = nearSide(frames);
  const lowVisShare = lowVisibilityShare(frames, side, rules);
  const samples: (Sample & { p: Pt[] })[] = frames.filter(f => f.p).map(f => ({ t: f.t, p: f.p!, m: overheadMeasure(f.p!, d, side, rules) }));
  // the unit for "still" is the phone's: the arm over the "Start!" hold
  const hold = all.filter(f => f.p && f.t >= w.start - r.startStillMs && f.t <= w.start).map(f => overheadMeasure(f.p!, d, side, rules).arm);
  const arm = hold.length ? median(hold) : median(samples.map(x => x.m.arm));
  const up = steady(samples.map(s => s.m.upBy)).map(v => v > 0);
  const reps: OverheadRep[] = [];

  for (let k = 1; k <= Math.max(declared, 1); k++) {
    const segStart = k === 1 ? w.start : repEnds[k - 2];
    if (segStart === undefined) break;
    const segEnd = repEnds[k - 1] ?? w.end;
    let idx = samples.map((s, i) => i).filter(i => (k === 1 ? samples[i].t >= segStart : samples[i].t > segStart) && samples[i].t <= segEnd + 100);
    // after a rep, the next starts only once the wrists have come back below the nose
    if (k > 1) { const firstDown = idx.findIndex(i => !up[i]); idx = firstDown < 0 ? [] : idx.slice(firstDown); }
    // this rep: the first time the wrists go above the nose, until they come back down
    const a = idx.findIndex(i => up[i]);
    let rep = a < 0 ? [] : idx.slice(a);
    const back = rep.findIndex(i => !up[i]);
    if (back >= 0) rep = rep.slice(0, back);
    const repSamples = rep.map(i => samples[i]);
    const lock = repSamples.length ? bestHold(repSamples, r, arm) : undefined;
    const seg = idx.map(i => samples[i]);
    const pool = repSamples.length ? repSamples : seg;
    const highest = pool.length ? pool.reduce((x, y) => (y.m.wr.y < x.m.wr.y ? y : x)) : undefined;
    const white = lock && lock.deg > r.lockoutElbowMinDeg;
    const borderline = lock && !white && lock.deg >= r.borderlineElbowMinDeg;
    // the judged frame: the first lockout frame, the best hold's, or the highest the wrists got
    const judged = white || borderline ? lock!.first : highest;
    if (!judged) { reps.push({ call: { light: 'red', reason: 'no_lockout' }, startMs: segStart, judgedFrameMs: segEnd }); break; }
    const call: Call = !overheadFrameSeen(judged.p, side, rules) ? VISIBILITY
      : white ? { light: 'white' } : borderline ? { light: 'close', reason: 'borderline_lockout' } : { light: 'red', reason: 'no_lockout' };
    reps.push({
      call, startMs: repSamples[0]?.t ?? segStart, judgedFrameMs: judged.t, ...(white && { endMs: segEnd }),
      lockoutElbowDeg: lock?.deg ?? pool.reduce((x, s) => Math.max(x, s.m.bothDeg), 0),
    });
    if (call.light === 'red') break;
  }

  let call: Call;
  if (lowVisShare > rules.visibilityCloseCallShare) call = VISIBILITY;
  else call = reps.find(x => x.call.light === 'red')?.call ?? reps.find(x => x.call.light === 'close')?.call ?? reps[0]?.call ?? { light: 'red', reason: 'no_lockout' };
  return { call, judgedFrameMs: reps[0]?.judgedFrameMs ?? null, reps, side, lowVisShare, noRep: !reps.some(x => x.endMs !== undefined) };
}
