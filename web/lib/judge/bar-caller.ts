// The phone's bench caller (plan 3.4b, item 74), as the bench commands test (tests/bench-commands/) passed it: "Start!", "Press!" and "Rack!" from the plate's trace,
// frame by frame, past frames only. The unit is the frame's height; y grows downward.
//
// Speed = the least-squares slope of the bar's position over the last `slopeMs` (frame heights per second).
// Start!: the bar has left the rack (moved `leftRack` from the tap), and since then its speed in both directions has
//         stayed under startRel x the lift-out's fastest (at least startFloor) for startStillMs, near the top.
// Press!: down at least pressDown, and its up-down speed under pressRel x this rep's fastest descent (at least
//         pressFloor) for pressStillMs.
// Rack!:  after Press!, back within rackRel x this rep's travel of the Start! height, held rackHoldMs.
// Late Press!, the short-pause Rack! and the 20 s no-rep Rack! are item 70's.
// Stuck track (3.4b, item 111): off the hooks, a score of STUCK.score or more with under 1 px of movement on the frame
//         for freezeBeforeMs (0.4 s) before Start! or freezeAfterMs (1.5 s) after it counts as lost, the window counted in
//         time (full when its oldest point is within the path's median gap of its start), and the stuck stretch is
//         dropped from the history. Before Start!: "We lost the
//         bar.", no Start!. After Start!: never Press! from stillness; if the track doesn't come back, a late Press!
//         2 s after the loss and Rack! 3 s after that.
// Missed start (3.4b, The Playner's 3:54 mail): off the hooks with no Start! within voidMs, or the track lost off the
//         hooks before Start! (stuck, or under lostScore for freezeMs): "Rack!", then "We lost the bar.", and the attempt
//         is void. Lost on the hooks before Start! is a re-tap, as before (no command).

import { RULES as ALL } from './rules';

/** The bench bar's numbers, from shared/rules.json `benchBar` (3.4b). */
export type BarRel = Omit<typeof ALL.benchBar, '$comment' | 'tracker'>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { $comment, tracker, ...BENCH_BAR } = ALL.benchBar;
export const BAR_RULES: BarRel = BENCH_BAR;
/** The stuck-track rule's numbers before Start!. The plan's guess was 0.99 for 0.3 s; 0.3 s calls a real held bar lost (IA0P). */
export const BAR_STUCK = { score: BAR_RULES.freezeScore, ms: BAR_RULES.freezeBeforeMs, afterMs: BAR_RULES.freezeAfterMs };

/** `why` on a late Press! (3.4b, `press_late_why`): `still`, down and still 1.5 s with no Press!, or `lost`, 2 s after the track was lost. */
export type BarCmd = {
  cmd: 'start' | 'press' | 'rack'; t: number; late?: boolean; why?: 'still' | 'lost'; noRep?: boolean; void?: boolean;
  /** item 109: the frozen-track rule held this Press! back (`command_times.press_held`) */
  held?: boolean;
};

type P = { t: number; x: number; y: number; score: number };

/** Least-squares slopes of y and x (x in frame heights) over the points at or after `from`, per second. */
function slope(h: P[], from: number): { vy: number; vx: number } | null {
  let n = 0, st = 0, sy = 0, sx = 0, stt = 0, sty = 0, stx = 0;
  for (let i = h.length - 1; i >= 0 && h[i].t >= from; i--) {
    const t = h[i].t / 1000; n++; st += t; sy += h[i].y; sx += h[i].x; stt += t * t; sty += t * h[i].y; stx += t * h[i].x;
  }
  if (n < 4) return null;
  const d = n * stt - st * st;
  return d > 0 ? { vy: (n * sty - st * sy) / d, vx: (n * stx - st * sx) / d } : null;
}

/**
 * Item 109 (3.4b, The Playner, Nov 20, 8:28 AM): when x and y stayed within `frozenStill` of the frame through the whole
 * pressStillMs window, the track may have stuck on something still while the bar sinks, so Press! waits until the bar
 * has been still `frozenPressMs` (1.0 s in shared/rules.json). The late Press! and the stuck rule run as before; a Press!
 * it held back says `held`. A test can turn it off with `frozenPressMs: 0`.
 */
export type FrozenPress = { frozenPressMs?: number; frozenStill?: number };
/** The stuck rule's still time before and after Start! (item 111: 0.4 s and 1.5 s in shared/rules.json). 0 turns it off there. */

export class BarCaller {
  state: 'racked' | 'waiting' | 'lifting' | 'pressed' | 'done' = 'racked';
  startY: number | null = null; startAt: number | null = null; pressAt: number | null = null; late = false;
  topY = Infinity; lowY = -Infinity; backSince: number | null = null; reachedTop = false; shortPauseAt: number | null = null;
  liftPeak = 0; descPeak = 0; descPeakY = -Infinity; leftAt: number | null = null;
  hist: P[] = []; all: P[] = [];
  speeds: { t: number; v: number; s: number }[] = [];
  private aspect: number; private h: number; private w: number; lostSince: number | null = null; frozeAt: number[] = []; frozeFrom: number[] = []; lostBeforeStart: number | null = null; lostPress = false;
  voidAt: number | null = null; private lowSince: number | null = null;
  /** item 109: the frozen-track rule held Press! back on this rep */
  held = false;
  /** the last positive gaps between points, for the path's median gap */
  private gaps: number[] = [];
  constructor(private tap: { x: number; y: number }, dims: { w: number; h: number }, private r: BarRel & FrozenPress = BAR_RULES, racked = true) {
    this.aspect = dims.w / dims.h; this.w = dims.w; this.h = dims.h;
    if (!racked) this.state = 'waiting';
  }
  /** Speed stayed under `lim` on every reading over the last `ms` (and the readings cover it). */
  private stillFor(t: number, ms: number, lim: number, xy: boolean) {
    const s = this.speeds; if (!s.length || t - s[0].t < ms) return false;
    let n = 0;
    for (let i = s.length - 1; i >= 0 && s[i].t >= t - ms; i--) { if ((xy ? s[i].s : Math.abs(s[i].v)) >= lim) return false; n++; }
    return n >= 3;
  }
  private spread(from: number) {
    let y0 = Infinity, y1 = -Infinity;
    for (let i = this.hist.length - 1; i >= 0 && this.hist[i].t >= from; i--) { y0 = Math.min(y0, this.hist[i].y); y1 = Math.max(y1, this.hist[i].y); }
    return y1 - y0;
  }
  /** Item 109: x and y within `still` of the frame (x in frame widths) on every reading over the last `ms`. */
  private heldMark(): { held?: true } { return this.held ? { held: true } : {}; }

  private frozenFor(t: number, ms: number, still: number) {
    const h = this.hist; if (!h.length || t - h[0].t < ms) return false;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0;
    for (let i = h.length - 1; i >= 0 && h[i].t >= t - ms; i--) {
      const x = h[i].x / this.aspect; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, h[i].y); y1 = Math.max(y1, h[i].y); n++;
    }
    return n >= 3 && x1 - x0 <= still && y1 - y0 <= still;
  }
  /** The median gap between points: one camera frame on a grid, the screen's tick on a live path that repeats frames. */
  private medGap() {
    const g = [...this.gaps].sort((a, b) => a - b);
    return g.length ? g[Math.floor(g.length / 2)] : 0;
  }
  /** Back-up band: rackRel x this rep's travel when set, else item 70's rackBack. */
  private back() { return this.r.rackRel > 0 ? this.r.rackRel * (this.lowY - this.startY!) : this.r.rackBack; }
  feed(t: number, x: number, y: number, score: number): BarCmd | null {
    const r = this.r;
    const p = { t, x: x * this.aspect, y, score };
    const prev = this.all.at(-1);
    if (prev && t > prev.t) { this.gaps.push(t - prev.t); if (this.gaps.length > 60) this.gaps.shift(); }
    this.all.push(p);
    let ok = score >= r.lostScore;
    if (this.state === 'done') return null;
    if (this.startAt !== null && this.state !== 'pressed' && t - this.startAt >= r.noRepMs) { this.state = 'done'; return { cmd: 'rack', t, noRep: true }; }
    // The stuck-track rule (The Playner's 3:35 mail, plan 3.4b): a score of 0.99 or more with under 1 px of movement on the
    // frame for freezeBeforeMs / freezeAfterMs counts as lost. Off the hooks only (a racked bar is still). Before Start!: "We lost the bar.", no Start!.
    // After Start!: never Press! from stillness; if the track doesn't come back, press_late 2 s after the loss, Rack! 3 s after.
    // The window is full when its oldest point is no later than its start plus the path's median gap (The Playner's
    // 8:47 AM mail), so the rule acts the same at any camera rate or screen tick.
    const fm = this.state === 'waiting' ? r.freezeBeforeMs : r.freezeAfterMs;
    if (r.stuckRule && fm > 0 && (this.state === 'waiting' || this.state === 'lifting' || (this.state === 'pressed' && this.lostPress)) && score >= r.freezeScore) {
      const back = this.all.filter(q => q.t >= t - fm);
      const still = back.length >= 3 && back[0].t <= t - fm + this.medGap() && back.every(q => q.score >= r.freezeScore && Math.abs(q.x / this.aspect - x) * this.w < 1 && Math.abs(q.y - y) * this.h < 1);
      if (still) {
        ok = false; this.frozeAt.push(t); this.frozeFrom.push(t - fm);
        // The stuck stretch was never the bar: take it out of the history, so no stillness is read from it.
        if (this.lostSince === null) { const from = t - fm; this.hist = this.hist.filter(q => q.t < from); this.speeds = this.speeds.filter(q => q.t < from); }
      }
    }
    if (this.state === 'waiting' && this.leftAt !== null) {
      // Lost off the hooks before Start!: stuck, or under lostScore for freezeMs.
      this.lowSince = score < r.lostScore ? (this.lowSince ?? t) : null;
      const stuck = !ok && r.stuckRule && score >= r.freezeScore;
      const low = this.lowSince !== null && t - this.lowSince >= r.freezeMs;
      if (stuck || (r.voidRule && low)) {
        this.state = 'done'; this.lostBeforeStart = t;
        if (!r.voidRule) return null;
        this.voidAt = t; return { cmd: 'rack', t, void: true };
      }
      // Off the hooks with no Start! within voidMs.
      if (r.voidRule && t - this.leftAt >= r.voidMs) { this.state = 'done'; this.voidAt = t; return { cmd: 'rack', t, void: true }; }
    }
    if (!ok && r.stuckRule && this.state === 'lifting') {
      if (this.lostSince === null) this.lostSince = this.frozeAt.at(-1) === t ? this.frozeFrom.at(-1)! : t;
      if (t - this.lostSince >= r.lostLateMs) { this.state = 'pressed'; this.pressAt = t; this.late = true; this.lostPress = true; this.backSince = null; return { cmd: 'press', t, late: true, why: 'lost', ...this.heldMark() }; }
      return null;
    }
    if (r.stuckRule && this.state === 'pressed' && this.lostPress) {
      if (!ok) { if (t - this.pressAt! >= r.lostRackMs) { this.state = 'done'; return { cmd: 'rack', t }; } return null; }
      this.lostPress = false; // the track came back: back to the usual back-up Rack!
    }
    if (ok) this.lostSince = null;
    if (!ok) return null;
    this.hist.push(p); while (this.hist.length && t - this.hist[0].t > 3000) this.hist.shift();
    const sl = slope(this.hist, t - r.slopeMs);
    if (sl === null) return null;
    const v = sl.vy, sp = Math.hypot(sl.vx, sl.vy);
    this.speeds.push({ t, v, s: sp }); while (this.speeds.length && t - this.speeds[0].t > 3000) this.speeds.shift();

    if (this.state === 'racked') {
      if (Math.hypot(p.x - this.tap.x * this.aspect, p.y - this.tap.y) >= r.leftRack) { this.state = 'waiting'; this.topY = p.y; this.leftAt = t; }
      return null;
    }
    if (this.state === 'waiting') {
      if (this.leftAt === null) this.leftAt = t;
      const spd = r.startXY ? sp : Math.abs(v);
      this.topY = Math.min(this.topY, p.y);
      this.liftPeak = Math.max(this.liftPeak, spd);
      const lim = Math.max(r.startFloor, r.startRel * this.liftPeak);
      if (t - this.leftAt >= r.startStillMs && this.stillFor(t, r.startStillMs, lim, r.startXY) && p.y - this.topY <= r.nearTop) {
        this.state = 'lifting'; this.startY = p.y; this.startAt = t; this.lowY = p.y;
        return { cmd: 'start', t };
      }
      return null;
    }
    if (this.state === 'lifting') {
      this.lowY = Math.max(this.lowY, p.y);
      if (v > this.descPeak) { this.descPeak = v; this.descPeakY = p.y; }
      const down = p.y - this.startY! >= r.pressDown && p.y - this.descPeakY >= r.pastPeakDown;
      const lim = Math.max(r.pressFloor, r.pressRel * this.descPeak);
      const frozen = !!r.frozenPressMs && this.frozenFor(t, r.pressStillMs, r.frozenStill ?? 0.002);
      const still = down && this.stillFor(t, r.pressStillMs, lim, r.pressXY);
      if (still && frozen && !this.stillFor(t, r.frozenPressMs!, lim, r.pressXY)) this.held = true;
      else if (still) {
        this.state = 'pressed'; this.pressAt = t; this.late = false; this.backSince = null;
        return { cmd: 'press', t, ...this.heldMark() };
      }
      if (p.y - this.startY! >= r.pressDown && t - this.hist[0].t >= r.lateMs && this.spread(t - r.lateMs) < r.lateStill) {
        this.state = 'pressed'; this.pressAt = t; this.late = true; this.backSince = null;
        return { cmd: 'press', t, late: true, why: 'still', ...this.heldMark() };
      }
      if (r.shortPause && this.lowY - this.startY! >= r.pressDown && p.y - this.startY! <= this.back()) {
        if (this.backSince === null) this.backSince = t;
        if (t - this.backSince >= r.rackHoldMs) { this.state = 'done'; this.shortPauseAt = t; return { cmd: 'rack', t }; }
      } else this.backSince = null;
      return null;
    }
    if (this.state === 'pressed') {
      if (this.state === 'pressed') this.lowY = Math.max(this.lowY, p.y);
      if (p.y - this.startY! <= this.back()) {
        this.reachedTop = true;
        if (this.backSince === null) this.backSince = t;
        if (t - this.backSince >= r.rackHoldMs) { this.state = 'done'; return { cmd: 'rack', t }; }
      } else this.backSince = null;
      if (t - this.pressAt! >= r.noRepMs) { this.state = 'done'; return { cmd: 'rack', t, noRep: true }; }
    }
    return null;
  }
}
