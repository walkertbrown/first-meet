// The commands, called live from what the judge sees (plan 3.4).
// Each caller is fed frames in time order and returns a command when one is due.
import { type Dims, type Frame, type Measures, type Side, measure, nearSide } from './pose';
import { checkSpot } from './frame-check';
import { RULES, type Rules } from './rules';

type Sample = { t: number; m: Measures };

/**
 * The hip's movement over the last `ms`, in torso lengths. Null until `ms` of frames are in hand.
 * The window opens on the last frame at or before `now - ms`, so a slow device (a frame every
 * 600 ms, say) still has two frames spanning it and can call the command.
 */
export function hipRange(hist: Sample[], now: number, ms: number): number | null {
  if (!hist.length || now - hist[0].t < ms) return null;
  let from = hist.length - 1;
  while (from > 0 && now - hist[from].t < ms) from--;
  const recent = hist.slice(from);
  if (recent.length < 2) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, torso = 0;
  for (const s of recent) {
    minX = Math.min(minX, s.m.hip.x); maxX = Math.max(maxX, s.m.hip.x);
    minY = Math.min(minY, s.m.hip.y); maxY = Math.max(maxY, s.m.hip.y);
    torso += s.m.torso;
  }
  torso /= recent.length;
  return Math.hypot(maxX - minX, maxY - minY) / torso;
}

export type SquatCommand = { cmd: 'squat' | 'rack'; t: number; noRep?: boolean } | { cmd: 'rep'; t: number; k: number };

/**
 * Squat: "Squat!" when she stands still and upright and the spot still passes;
 * "Rack!" after down (knee < 140°) and up (knee > 160°) and 0.5 s still;
 * "Rack!" anyway 20 s after "Squat!" with no rep.
 *
 * `reps` (a Home attempt, 3.8a): each rep is counted when she stands back up ("rep", k), and
 * "Rack!" comes after the declared reps and 0.5 s still. With no rep for 20 s it racks anyway.
 */
export class SquatCaller {
  state: 'waiting' | 'lifting' | 'done' = 'waiting';
  squatAt: number | null = null;
  rackAt: number | null = null;
  wentDown = false;
  repsDone = 0;
  private counted = false;
  private lastRepAt: number | null = null;
  private pending: SquatCommand | null = null;
  private hist: Sample[] = [];
  private side: Side | null = null;
  /** `skipFrameCheck`: "Squat!" doesn't wait for the spot (the tests' 3/4 clips; plan 3.4, piece 1). */
  constructor(private d: Dims, private rules: Rules = RULES, private skipFrameCheck = false, private reps = 1) {}

  feed(f: Frame): SquatCommand | null {
    if (this.pending) { const p = this.pending; this.pending = null; return p; }
    const r = this.rules.squat;
    if (this.state === 'done') return null;
    // one rep: 20 s from "Squat!"; many: 20 s from the last rep
    const since = this.reps > 1 ? (this.lastRepAt ?? this.squatAt) : this.squatAt;
    if (this.state === 'lifting' && since !== null && f.t - since >= r.noRepMs) {
      this.state = 'done'; this.rackAt = f.t;
      return { cmd: 'rack', t: f.t, noRep: this.repsDone === 0 && !this.wentDown };
    }
    if (!f.p) { this.hist = []; return null; }
    const side = this.side ?? nearSide(f);
    const m = measure(f.p, this.d, side);
    this.hist.push({ t: f.t, m });
    while (this.hist.length && f.t - this.hist[0].t > 2000) this.hist.shift();

    if (this.state === 'waiting') {
      const range = hipRange(this.hist, f.t, r.stillMs);
      if (m.knee_deg > r.standKneeMinDeg && range !== null && range < r.stillHipMaxTorso && (this.skipFrameCheck || checkSpot(f.p, this.d, this.rules).ok)) {
        this.state = 'lifting'; this.squatAt = f.t; this.side = side;
        return { cmd: 'squat', t: f.t };
      }
      return null;
    }
    // lifting
    if (m.knee_deg < r.downKneeMaxDeg) this.wentDown = true;
    let rep: SquatCommand | null = null;
    if (this.wentDown && m.knee_deg > r.standKneeMinDeg) {
      if (!this.counted) {
        this.counted = true; this.repsDone++; this.lastRepAt = f.t;
        rep = { cmd: 'rep', t: f.t, k: this.repsDone };
      }
      if (this.repsDone < this.reps) {
        // up from this rep: the next one starts
        this.wentDown = false; this.counted = false;
        return rep;
      }
      const range = hipRange(this.hist.filter(s => s.m.knee_deg > r.standKneeMinDeg), f.t, r.rackStillMs);
      if (range !== null && range < r.stillHipMaxTorso) {
        this.state = 'done'; this.rackAt = f.t;
        const rack: SquatCommand = { cmd: 'rack', t: f.t };
        if (rep) { this.pending = rack; return rep; }
        return rack;
      }
    }
    return rep;
  }
}

export type DeadliftCommand = { cmd: 'start-window' | 'down'; t: number; noLockout?: boolean };

/**
 * Deadlift: no start command. The window starts when the hip rises 2% of torso
 * length above where it was during "Bar is loaded."; "Down!" when the hip and
 * knee angles are both over 165° for 0.4 s; "Down!" anyway 12 s after the window
 * starts with no lockout.
 */
export class DeadliftCaller {
  state: 'loaded' | 'lifting' | 'done' = 'loaded';
  windowAt: number | null = null;
  downAt: number | null = null;
  private base: { y: number; torso: number; n: number } = { y: 0, torso: 0, n: 0 };
  private lockSince: number | null = null;
  private side: Side | null = null;
  constructor(private d: Dims, private rules: Rules = RULES) {}

  feed(f: Frame): DeadliftCommand | null {
    const r = this.rules.deadlift;
    if (this.state === 'done') return null;
    if (this.state === 'lifting' && this.windowAt !== null && f.t - this.windowAt >= r.noLockoutMs) {
      this.state = 'done'; this.downAt = f.t;
      return { cmd: 'down', t: f.t, noLockout: true };
    }
    if (!f.p) return null;
    const side = this.side ?? nearSide(f);
    const m = measure(f.p, this.d, side);
    if (this.state === 'loaded') {
      if (this.base.n >= 3 && this.base.y - m.hip.y > r.windowStartHipRiseTorso * (this.base.torso / this.base.n)) {
        this.state = 'lifting'; this.windowAt = f.t; this.side = side;
        return { cmd: 'start-window', t: f.t };
      }
      // the baseline is the hip's lowest steady place while loaded (largest y)
      if (this.base.n === 0 || m.hip.y > this.base.y) this.base.y = m.hip.y;
      this.base.torso += m.torso; this.base.n++;
      return null;
    }
    if (m.hip_deg > r.lockoutMinDeg && m.knee_deg > r.lockoutMinDeg) {
      if (this.lockSince === null) this.lockSince = f.t;
      if (f.t - this.lockSince >= r.lockoutHoldMs) {
        this.state = 'done'; this.downAt = f.t;
        return { cmd: 'down', t: f.t };
      }
    } else this.lockSince = null;
    return null;
  }
}
