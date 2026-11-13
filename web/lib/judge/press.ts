// The bench press (Barbell, plan 3.4): the commands the phone calls live, and the call the server
// makes from the recording and the phone's command times. Home's press is the overhead press
// (overhead.ts); nothing judges a floor press.
import { type Dims, type Frame, type Pt, type Side, type XY, angle, dist, nearSide, px, SIDES } from './pose';
import { RULES, type Rules } from './rules';
import { judgedFrameSeen, JUDGED_POINTS, lowVisibilityShare, type AttemptResult, type Call, type RepResult, type Window } from './call';

const other = (s: Side): Side => (s === 'left' ? 'right' : 'left');

/** One frame's press measures on the near side, and the far elbow when it can be seen. */
export function pressMeasure(p: Pt[], d: Dims, side: Side, rules: Rules = RULES) {
  const s = SIDES[side], o = SIDES[other(side)];
  const sh = px(p, s.shoulder, d), el = px(p, s.elbow, d), wr = px(p, s.wrist, d);
  const osh = px(p, o.shoulder, d), oel = px(p, o.elbow, d), owr = px(p, o.wrist, d);
  const near = angle(sh, el, wr);
  const farSeen = Math.min(osh.v, oel.v, owr.v) >= rules.visibilityMin;
  const far = angle(osh, oel, owr);
  return {
    sh, el, wr,
    /** The near elbow's angle (shoulder-elbow-wrist). */
    elbowDeg: near,
    /** Both elbows: the lower of the two angles, or the near one when the far arm can't be seen. */
    bothDeg: farSeen ? Math.min(near, far) : near,
    farSeen,
    /** Shoulder to elbow to wrist, in pixels. */
    arm: dist(sh, el) + dist(el, wr) || 1,
  };
}
export type PressMeasures = ReturnType<typeof pressMeasure>;

export type Sample = { t: number; m: PressMeasures };

/** The middle of three: steadies one value against a single jumpy frame. */
export const median3 = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
export const steady = (v: number[]) => v.map((x, i) => median3(v[Math.max(0, i - 1)], x, v[Math.min(v.length - 1, i + 1)]));
export const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

/**
 * How far a point moved over the frames given, in arm lengths: the size of the box it moved in,
 * each coordinate steadied over three frames so one jumpy landmark doesn't read as movement.
 * `arm` is the straight arm's length in pixels; without it, the frames' own (foreshortened) arm.
 */
export function moved(list: Sample[], pick: (m: PressMeasures) => XY, arm?: number): number {
  const xs = steady(list.map(s => pick(s.m).x)), ys = steady(list.map(s => pick(s.m).y));
  const unit = arm ?? list.reduce((a, s) => a + s.m.arm, 0) / list.length;
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / unit;
}

/** The point's movement over the last `ms` (from the last frame at or before now − ms), or null until `ms` is in hand. */
export function pointRange(hist: Sample[], now: number, ms: number, pick: (m: PressMeasures) => XY, arm?: number): number | null {
  if (!hist.length || now - hist[0].t < ms) return null;
  let from = hist.length - 1;
  while (from > 0 && now - hist[from].t < ms) from--;
  const recent = hist.slice(from);
  return recent.length < 2 ? null : moved(recent, pick, arm);
}

export type PressCommand =
  | { cmd: 'start'; t: number }
  | { cmd: 'press'; t: number; k: number; late?: boolean }
  | { cmd: 'rep'; t: number; k: number }
  | { cmd: 'rack'; t: number; noRep?: boolean };

/**
 * The `command_times` key for rep k's "Press!": `press`, then `press_2`, `press_3`, …. A late
 * "Press!" (the pose missed the bent elbow, 3.4) is `press_late`, `press_late_2`, … in its place.
 */
export const pressKey = (k: number, late = false) => {
  const base = late ? 'press_late' : 'press';
  return k === 1 ? base : `${base}_${k}`;
};

/**
 * The bench (Barbell), 3.4:
 * - "Start!" when the elbows are over 155° and the wrists still (under 7% of the arm, each
 *   coordinate steadied over three frames) for 0.5 s;
 * - "Press!" when, after the elbows bend below 110°, the wrists stay still for 0.4 s;
 * - "Press!" anyway, marked late, when the wrists are 0.3 arm or more below where they were at
 *   "Start!" and still for 1.5 s with no "Press!": she's never left holding the bar on her chest;
 * - the rep ends when the elbows pass 155° again and hold for 0.4 s, then "Rack!";
 * - "Rack!" anyway 20 s after "Start!" with no rep.
 */
export class BenchCaller {
  state: 'waiting' | 'lifting' | 'done' = 'waiting';
  /** Within a rep: going down, down (the elbows under 110°), and pressed (after "Press!"). */
  phase: 'up' | 'down' | 'pressed' = 'up';
  startAt: number | null = null;
  rackAt: number | null = null;
  repsDone = 0;
  /** "Press!" times, one per rep that had one. */
  presses: Record<number, number> = {};
  /** Reps whose "Press!" was called late. */
  late = new Set<number>();
  /** The straight arm's length in pixels, taken over the "Start!" hold: the unit for "still". */
  armRef: number | null = null;
  /** Where the wrist was (image y, pixels) over the "Start!" hold. */
  startWristY: number | null = null;
  private lockSince: number | null = null;
  private queue: PressCommand[] = [];
  private hist: Sample[] = [];
  private side: Side | null = null;
  constructor(private d: Dims, private rules: Rules = RULES) {}

  feed(f: Frame): PressCommand | null {
    if (this.queue.length) return this.queue.shift()!;
    const r = this.rules.bench;
    if (this.state === 'done') return null;
    if (this.state === 'lifting') {
      if (f.t - this.startAt! >= r.noRepMs) {
        this.state = 'done'; this.rackAt = f.t;
        return { cmd: 'rack', t: f.t, noRep: this.repsDone === 0 && this.phase === 'up' };
      }
    }
    if (!f.p) { this.hist = []; return null; }
    const side = this.side ?? nearSide(f);
    const m = pressMeasure(f.p, this.d, side, this.rules);
    this.hist.push({ t: f.t, m });
    while (this.hist.length && f.t - this.hist[0].t > 2000) this.hist.shift();

    if (this.state === 'waiting') {
      const still = pointRange(this.hist, f.t, r.startStillMs, x => x.wr);
      if (m.bothDeg > r.startElbowMinDeg && still !== null && still < r.pauseStillMaxArm) {
        this.state = 'lifting'; this.startAt = f.t; this.side = side; this.phase = 'up';
        const held = this.hist.filter(x => f.t - x.t <= r.startStillMs);
        this.armRef = median(held.map(x => x.m.arm));
        this.startWristY = median(held.map(x => x.m.wr.y));
        return { cmd: 'start', t: f.t };
      }
      return null;
    }

    if (this.phase === 'up' && m.elbowDeg < r.bottomElbowMaxDeg) this.phase = 'down';
    if (this.phase === 'down') {
      const still = pointRange(this.hist, f.t, r.pauseStillMs, x => x.wr, this.armRef!);
      if (still !== null && still < r.pauseStillMaxArm) return this.press(f.t, this.repsDone + 1);
    }
    if (this.phase === 'up') {
      // the pose missed the bent elbow: the bar is down and still, so call it anyway (late)
      const drop = (m.wr.y - this.startWristY!) / this.armRef!;
      if (drop >= r.pressLateDropArm) {
        const still = pointRange(this.hist, f.t, r.pressLateStillMs, x => x.wr, this.armRef!);
        if (still !== null && still < r.pauseStillMaxArm) return this.press(f.t, this.repsDone + 1, true);
      }
    }
    // a rep ends at lockout, pressed on the call or not (pressing early is the judge's red, not the phone's).
    // After a late "Press!" the elbows may read straight with the bar still down, so the wrists must
    // also be back above the late line.
    const k = this.repsDone + 1;
    const backUp = !this.late.has(k) || (m.wr.y - this.startWristY!) / this.armRef! < r.pressLateDropArm;
    if (this.phase !== 'up' && m.bothDeg > r.lockoutElbowMinDeg && backUp) {
      if (this.lockSince === null) this.lockSince = f.t;
      if (f.t - this.lockSince >= r.lockoutHoldMs) {
        this.lockSince = null; this.phase = 'up';
        this.repsDone++;
        this.state = 'done'; this.rackAt = f.t;
        this.queue.push({ cmd: 'rack', t: f.t });
        return { cmd: 'rep', t: f.t, k: this.repsDone };
      }
    } else this.lockSince = null;
    return null;
  }

  private press(t: number, k: number, late = false): PressCommand {
    this.phase = 'pressed'; this.presses[k] = t;
    if (late) this.late.add(k);
    return late ? { cmd: 'press', t, k, late } : { cmd: 'press', t, k };
  }
}

export type PressTimes = {
  /** "Press!" per rep, by rep number (rep 1 is `press` or `press_late`). */
  presses: Record<number, number>;
  /** Reps whose "Press!" the phone called late (`press_late`, `press_late_2`, …). */
  late?: Set<number>;
  /** Each rep's end (`rep_1`, …), in order, when the phone wrote them. */
  repEnds: number[];
};

/** Reads the press times out of `command_times`. */
export function pressTimes(ct: Record<string, number>): PressTimes {
  const presses: Record<number, number> = {};
  const late = new Set<number>();
  const repEnds: [number, number][] = [];
  for (const [key, t] of Object.entries(ct)) {
    const p = /^press(_late)?(?:_(\d+))?$/.exec(key);
    if (p) {
      const k = p[2] ? Number(p[2]) : 1;
      presses[k] = t;
      if (p[1]) late.add(k);
    }
    const e = /^rep_?(\d+)$/.exec(key);
    if (e) repEnds.push([Number(e[1]), t]);
  }
  return { presses, late, repEnds: repEnds.sort((a, b) => a[0] - b[0]).map(x => x[1]) };
}

const VISIBILITY: Call = { light: 'close', reason: 'visibility' };

/** The first frame of a run with both elbows past `minDeg` (steadied over three frames) lasting `holdMs`. */
function heldLockout(list: Sample[], minDeg: number, holdMs: number): Sample | undefined {
  const deg = steady(list.map(s => s.m.bothDeg));
  let runFrom = -1;
  for (let i = 0; i < list.length; i++) {
    if (deg[i] <= minDeg) { runFrom = -1; continue; }
    if (runFrom < 0) runFrom = i;
    if (list[i].t - list[runFrom].t >= holdMs) return list[runFrom];
  }
  return undefined;
}

export type PressRep = RepResult & {
  pressMs?: number;
  /** How long the server saw it still before "Press!". */
  pauseMs?: number;
  /** How far the wrist rose from its lowest point before "Press!", in arm lengths. */
  riseArm?: number;
  lockoutElbowDeg?: number;
};

/**
 * The press call (3.4), per rep:
 * - white if, after "Press!", both elbows pass 155° before the rep's end ("Rack!");
 * - red `no_lockout` if they don't;
 * - red `no_pause` if the wrist rose more than 3% of arm length from its lowest point before
 *   "Press!", or the rep was pressed with no "Press!" at all: only when the server saw the elbows
 *   bend below 110° on that rep. If it never did, close `visibility` (we didn't see the bottom);
 * - close `short_pause` if the wrist's still that the server measures before "Press!" is under 0.3 s;
 * - close `visibility` if the near shoulder, elbow or wrist isn't seen on the "Press!" frame, and
 *   always for a late "Press!" (`press_late`).
 */
export function judgePress(all: Frame[], d: Dims, w: Window, times: PressTimes, rules: Rules = RULES): AttemptResult & { reps: PressRep[] } {
  const r = rules.bench;
  const frames = all.filter(f => f.t >= w.start && f.t <= w.end);
  const side = nearSide(frames);
  const lowVisShare = lowVisibilityShare(frames, side, rules);
  const samples: (Sample & { p: Pt[] })[] = frames.filter(f => f.p).map(f => ({ t: f.t, p: f.p!, m: pressMeasure(f.p!, d, side, rules) }));
  const pressNums = Object.keys(times.presses).map(Number);
  const count = Math.max(times.repEnds.length, pressNums.length ? Math.max(...pressNums) : 0);
  const reps: PressRep[] = [];
  const stillOf = (m: PressMeasures) => m.wr;
  // the unit for "still" and "rise" is the phone's: the straight arm over the "Start!" hold (the bent arm
  // reads short when it points at the camera); failing that, the attempt's straight arm
  const hold = all.filter(f => f.p && f.t >= w.start - r.startStillMs && f.t <= w.start).map(f => pressMeasure(f.p!, d, side, rules).arm);
  const straight = samples.filter(x => x.m.bothDeg > r.lockoutElbowMinDeg).map(x => x.m.arm);
  const armRef = hold.length ? median(hold) : straight.length ? median(straight) : median(samples.map(x => x.m.arm));
  const holdY = all.filter(f => f.p && f.t >= w.start - r.startStillMs && f.t <= w.start).map(f => pressMeasure(f.p!, d, side, rules).wr.y);
  const startY = holdY.length ? median(holdY) : samples[0]?.m.wr.y ?? 0;

  for (let k = 1; k <= Math.max(count, 1); k++) {
    const segStart = k === 1 ? w.start : times.repEnds[k - 2];
    const segEnd = times.repEnds[k - 1] ?? w.end;
    if (segStart === undefined) break;
    const seg = samples.filter(s => s.t > segStart || (k === 1 && s.t >= segStart)).filter(s => s.t <= segEnd + 100);
    const downAt = seg.find(s => s.m.elbowDeg < r.bottomElbowMaxDeg)?.t ?? null;
    const pressAt = times.presses[k] ?? null;
    if (pressAt === null) {
      if (downAt === null) {
        if (count === 0) {
          // the bar came down (the late line) and went back up, but no one saw the elbows bend: a referee's call
          const low = seg.reduce<Sample | null>((a, s) => (!a || s.m.wr.y > a.m.wr.y ? s : a), null);
          if (low && (low.m.wr.y - startY) / armRef >= r.pressLateDropArm) {
            reps.push({ call: VISIBILITY, startMs: segStart, judgedFrameMs: low.t });
          }
          break; // otherwise no rep at all: the attempt's no-rep red below
        }
        // the phone ended a rep it saw go down, but the server never saw the bottom: a referee's call
        reps.push({ call: VISIBILITY, startMs: segStart, judgedFrameMs: seg.at(-1)?.t ?? segEnd });
        continue;
      }
      // down and back up with no "Press!": pressed before the call
      const bottom = seg.filter(s => s.t >= downAt).reduce((a, b) => (b.m.wr.y > a.m.wr.y ? b : a));
      const seen = judgedFrameSeen(bottom.p, side, JUDGED_POINTS.press, rules);
      reps.push({ call: seen ? { light: 'red', reason: 'no_pause' } : VISIBILITY, startMs: downAt, judgedFrameMs: bottom.t });
      continue;
    }
    const before = seg.filter(s => s.t <= pressAt);
    const pf = before.at(-1) ?? seg[0];
    if (!pf) { reps.push({ call: VISIBILITY, startMs: segStart, judgedFrameMs: pressAt, pressMs: pressAt }); continue; }

    // the wrist's rise from its lowest point (largest y) to "Press!", steadied over 3 frames
    const fromDown = before.filter(s => downAt === null || s.t >= downAt);
    const ys = fromDown.map((s, i) => median3(fromDown[Math.max(0, i - 1)].m.wr.y, s.m.wr.y, fromDown[Math.min(fromDown.length - 1, i + 1)].m.wr.y));
    let low = -Infinity, rise = 0;
    for (const y of ys) { low = Math.max(low, y); rise = Math.max(rise, (low - y) / armRef); }

    // how long it was still before "Press!": the longest stretch ending at the press frame that stays
    // within the still limit, measured as the phone measures it (over the whole stretch, steadied)
    let from = before.length - 1;
    for (let j = 0; j < before.length - 1; j++) {
      if (moved(before.slice(j), stillOf, armRef) < r.pauseStillMaxArm) { from = j; break; }
    }
    const pauseMs = pressAt - before[from].t;

    // after "Press!", both elbows past 155° before the rep's end, held as long as the phone holds
    // it to end a rep (one jumpy frame isn't a lockout)
    const after = seg.filter(s => s.t > pressAt);
    const lock = heldLockout(after, r.lockoutElbowMinDeg, r.lockoutHoldMs);
    const bestElbow = after.reduce((a, s) => Math.max(a, s.m.bothDeg), 0);

    let call: Call;
    if (times.late?.has(k)) call = VISIBILITY;
    else if (!judgedFrameSeen(pf.p, side, JUDGED_POINTS.press, rules)) call = VISIBILITY;
    else if (rise > r.noPauseRiseArm) call = downAt === null ? VISIBILITY : { light: 'red', reason: 'no_pause' };
    else if (!lock) call = { light: 'red', reason: 'no_lockout' };
    else if (pauseMs < r.serverPauseMinMs) call = { light: 'close', reason: 'short_pause' };
    else call = { light: 'white' };
    reps.push({
      call, startMs: downAt ?? segStart, judgedFrameMs: pf.t, ...(lock && { endMs: lock.t }),
      pressMs: pressAt, pauseMs, riseArm: rise, lockoutElbowDeg: lock?.m.bothDeg ?? bestElbow,
    });
  }

  let call: Call;
  if (lowVisShare > rules.visibilityCloseCallShare) call = VISIBILITY;
  else if (!reps.length) call = { light: 'red', reason: 'no_lockout' };
  else call = reps[0].call;
  return { call, judgedFrameMs: reps[0]?.judgedFrameMs ?? null, reps, side, lowVisShare, noRep: !reps.length };
}
