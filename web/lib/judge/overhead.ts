// The overhead press (Home, if the Home press test fails; plan 3.7 and 5.34): the commands the
// phone calls live, and the call the server makes from the recording and the phone's rep ends.
import { type Dims, type Frame, type Pt, type Side, L, nearSide, px, SIDES } from './pose';
import { RULES, type Rules } from './rules';
import { judgedFrameSeen, JUDGED_POINTS, lowVisibilityShare, type AttemptResult, type Call, type RepResult, type Window } from './call';
import { median, moved, pointRange, pressMeasure, steady } from './press';

/** One frame's overhead measures: the press measures, plus where the wrists are against the nose. */
export function overheadMeasure(p: Pt[], d: Dims, side: Side, rules: Rules = RULES) {
  const m = pressMeasure(p, d, side, rules);
  const far = SIDES[side === 'left' ? 'right' : 'left'];
  // the nose, or the near ear when the nose is turned away
  const nose = px(p, L.nose, d);
  const head = nose.v >= rules.visibilityMin ? nose : px(p, SIDES[side].ear, d);
  const owr = px(p, far.wrist, d);
  return {
    ...m,
    /** Both wrists above the nose (the far one only when its arm can be seen). */
    wristsUp: m.wr.y < head.y && (!m.farSeen || owr.y < head.y),
    /** How far the near wrist sits from shoulder height, in pixels (positive: above). */
    wristOverShoulder: m.sh.y - m.wr.y,
  };
}
export type OverheadMeasures = ReturnType<typeof overheadMeasure>;
type Sample = { t: number; m: OverheadMeasures };

const locked = (m: OverheadMeasures, r: Rules['overhead']) => m.bothDeg > r.lockoutElbowMinDeg && m.wristsUp;
const atShoulders = (m: OverheadMeasures, r: Rules['overhead'], arm: number) =>
  m.elbowDeg < r.startElbowMaxDeg && Math.abs(m.wristOverShoulder) <= r.startWristFromShoulderArm * arm;

export type OverheadCommand = { cmd: 'start'; t: number } | { cmd: 'rep'; t: number; k: number } | { cmd: 'rack'; t: number; noRep?: boolean };

/**
 * The overhead press (3.7):
 * - "Start!" with the dumbbells at her shoulders (elbows bent under 110°, wrists within 0.3 arm of
 *   shoulder height), still for 0.5 s;
 * - no "Press!";
 * - a rep ends when both elbows are over 165° with the wrists above the nose, still for 0.4 s; the
 *   next one can start once the elbows bend back under 110°;
 * - "Rack!" after the declared reps, 8 s after a rep with no new one (3.8a), or 20 s after
 *   "Start!" with no rep.
 */
export class OverheadCaller {
  state: 'waiting' | 'lifting' | 'done' = 'waiting';
  /** Within the set: ready for a rep (at the shoulders or on the way up), or locked out. */
  phase: 'ready' | 'locked' = 'ready';
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
      if (still !== null && still < r.stillMaxArm && recent.every(x => atShoulders(x.m, r, arm))) {
        this.state = 'lifting'; this.startAt = f.t; this.side = side; this.phase = 'ready'; this.armRef = arm;
        return { cmd: 'start', t: f.t };
      }
      return null;
    }

    if (this.phase === 'locked') {
      if (m.elbowDeg < r.startElbowMaxDeg) this.phase = 'ready';
      return null;
    }
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

/** The first frame of a lockout (steadied over three frames) held `holdMs` with the wrists still. */
function heldLockout(list: Sample[], r: Rules['overhead'], arm: number): Sample | undefined {
  const deg = steady(list.map(s => s.m.bothDeg));
  let from = -1;
  for (let i = 0; i < list.length; i++) {
    if (deg[i] <= r.lockoutElbowMinDeg || !list[i].m.wristsUp) { from = -1; continue; }
    if (from < 0) from = i;
    // the still stretch must be the last holdMs of the run, as the phone measures it
    let j = i;
    while (j > from && list[i].t - list[j - 1].t <= r.lockoutStillMs) j--;
    if (list[i].t - list[from].t >= r.lockoutStillMs && moved(list.slice(j, i + 1), x => x.wr, arm) < r.stillMaxArm) return list[from];
  }
  return undefined;
}

export type OverheadRep = RepResult & { lockoutElbowDeg?: number };

const VISIBILITY: Call = { light: 'close', reason: 'visibility' };

/**
 * The overhead press call (3.7), per declared rep:
 * - white when both elbows are over 165° with the wrists above the nose, still for 0.4 s, before
 *   the rep's end (the phone's `rep_k`, or "Rack!");
 * - red `no_lockout` otherwise (a rep she started and didn't lock out, or didn't do before "Rack!");
 * - close `visibility` if the near shoulder, elbow or wrist isn't seen on the judged frame.
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
  const reps: OverheadRep[] = [];

  for (let k = 1; k <= Math.max(declared, 1); k++) {
    const segStart = k === 1 ? w.start : repEnds[k - 2];
    if (segStart === undefined) break;
    const segEnd = repEnds[k - 1] ?? w.end;
    const seg = samples.filter(s => (k === 1 ? s.t >= segStart : s.t > segStart) && s.t <= segEnd + 100);
    const lock = heldLockout(seg, r, arm);
    // the judged frame: the first lockout frame, or the highest the wrists got
    const judged = lock ?? (seg.length ? seg.reduce((a, b) => (b.m.wr.y < a.m.wr.y ? b : a)) : undefined);
    if (!judged) { reps.push({ call: { light: 'red', reason: 'no_lockout' }, startMs: segStart, judgedFrameMs: segEnd }); break; }
    const seen = judgedFrameSeen((judged as Sample & { p: Pt[] }).p, side, JUDGED_POINTS.press, rules);
    const call: Call = !seen ? VISIBILITY : lock ? { light: 'white' } : { light: 'red', reason: 'no_lockout' };
    reps.push({
      call, startMs: segStart, judgedFrameMs: judged.t, ...(lock && { endMs: segEnd }),
      lockoutElbowDeg: lock?.m.bothDeg ?? seg.reduce((a, s) => Math.max(a, s.m.bothDeg), 0),
    });
    if (call.light === 'red') break;
  }

  let call: Call;
  if (lowVisShare > rules.visibilityCloseCallShare) call = VISIBILITY;
  else call = reps.find(x => x.call.light === 'red')?.call ?? reps.find(x => x.call.light === 'close')?.call ?? reps[0]?.call ?? { light: 'red', reason: 'no_lockout' };
  return { call, judgedFrameMs: reps[0]?.judgedFrameMs ?? null, reps, side, lowVisShare, noRep: !reps.some(x => x.endMs !== undefined) };
}
