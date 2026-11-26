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
//         dropped from the history. Before Start! it counts only while the track is within freezeNearTapPct (8%) of
//         her tap, measured as leftRack is (The Playner's ruling, Nov 20, 9:23 AM; 0 counts it anywhere). Before Start!: "We lost the
//         bar.", no Start!. After Start!: never Press! from stillness across a loss (a lost or stuck track, or a camera
//         stop of 500 ms or more): a late Press! 2 s after the loss even if the bar comes back, waiting while it's seen going
//         down, and Rack! 3 s after that. After a normal Press!: Rack! 3 s after a loss, unless the track comes back first (item 116). After a normal Press!: Rack! 3 s after the guard
//         marks it, unless the track comes back first (item 116).
// Missed start (3.4b, The Playner's 3:54 mail): off the hooks with no Start! within voidMs, or the track lost off the
//         hooks before Start! (stuck, or under lostScore for lowScoreBeforeMs): "Rack!", then "We lost the bar.", and the attempt
//         is void. Lost on the hooks before Start! is a re-tap, as before (no command).

import { RULES as ALL } from './rules';

/** The bench bar's numbers, from shared/rules.json `benchBar` (3.4b). */
export type BarRel = Omit<typeof ALL.benchBar, '$comment' | 'tracker' | 'guardAfterPress'> & { guardAfterPress?: boolean | 'from' };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { $comment, tracker, ...BENCH_BAR } = ALL.benchBar;
if (BENCH_BAR.guardAfterPress !== 'from') throw new Error('shared/rules.json: benchBar.guardAfterPress must be "from"');
export const BAR_RULES: BarRel = { ...BENCH_BAR, guardAfterPress: 'from' };
/** The stuck-track rule's numbers before Start!. The plan's guess was 0.99 for 0.3 s; 0.3 s calls a real held bar lost (IA0P). */
export const BAR_STUCK = { score: BAR_RULES.freezeScore, ms: BAR_RULES.freezeBeforeMs, afterMs: BAR_RULES.freezeAfterMs };

/** Item 112 (3.4b, "The void has three causes"): why the bench was voided with no Start! out of the rack. `no_start_5s`:
 *  off the hooks voidMs with no Start!; `stuck`: the stuck rule within freezeNearTapPct of her tap; `low_score`: under
 *  lostScore for lowScoreBeforeMs (its own key, the Playner's 9:37 AM ruling: a change to the stuck window never moves it). It goes in the void's post and the `lost_bar_void` row, and picks the sheet's words. */
export type VoidWhy = 'no_start_5s' | 'stuck' | 'low_score';
export const VOID_WHYS: readonly VoidWhy[] = ['no_start_5s', 'stuck', 'low_score'];

/** `why` on a late Press! (3.4b, `press_late_why`): `still`, down and still 1.5 s with no Press!, or `lost`, 2 s after the track was lost. */
/** Item 116 (3.4b, `rack_why`): why a "Rack!" came. `up`, the bar seen back up; `lost`, 3 s after a loss; `no_rep`, the no-rep rule. None on a void. */
export type RackWhy = 'up' | 'lost' | 'no_rep';
export const RACK_WHYS: readonly RackWhy[] = ['up', 'lost', 'no_rep'];

export type BarCmd = {
  cmd: 'start' | 'press' | 'rack'; t: number; late?: boolean; why?: 'still' | 'lost'; noRep?: boolean; void?: boolean; voidWhy?: VoidWhy; rackWhy?: RackWhy;
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
export type FrozenPress = {
  frozenPressMs?: number; frozenStill?: number;
  /** Item 116 (3.4b): the stuck guard after a normal Press!. `from` (the Playner's ruling, 1:03 AM): stuck time counts from
   *  the later of the stretch's start and Press!, never back across it, so a picture that froze in her pause is marked
   *  1.5 s after Press!, and the blanked stretch starts at Press! at the earliest. `true`: the 1.5 s looks back past Press!
   *  (the 12:54 AM wording; it blanks IA0P's real pause). Walker's yes, 1:03 AM: `from`, in shared/rules.json.
   *  tests/bench-commands/guard-after-press.ts runs both against it off. */
  guardAfterPress?: boolean | 'from';
};
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
  /** Item 114 (3.2) and 3.4b's "Lost after Start!" (Walker's yes, Nov 26, 12:54 AM): after Start! and before Press!, when
   *  the bar first counted as lost: the last frame before a camera stop of noFrameMs or more, or the track's loss (lost
   *  or stuck). "Press!" comes lostLateMs after it, never from stillness, even if the track or the frames come back, and
   *  waits while the bar is seen going down; the short-pause Rack! still runs if she's seen back up first. */
  stopAt: number | null = null;
  /** Item 116 (3.4b, "Lost after a normal Press!"): when the bar was lost after a Press! from stillness; null while it's seen. */
  pressLostSince: number | null = null;
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
  /** Item 114: the camera stopped noFrameMs or more after Start! and before Press! (3.2, "A stop of 500 ms or more"). */
  private markStop(lastT: number) {
    if (this.state !== 'lifting' || this.stopAt !== null) return;
    this.stopAt = lastT; this.lostSince = Math.min(this.lostSince ?? lastT, lastT);
  }
  /** 3.4 and 3.4b ("Press!" never comes while the bar is still going down; Walker's yes, 12:54 AM): after a loss, the bar back and
   *  the bar seen going down (up-down speed at or over the Press! line: pressRel x this rep's fastest descent, at least
   *  pressFloor), the late Press! waits until it's seen stopped. */
  private seenGoingDown(lastT: number | undefined) {
    const s = this.speeds.at(-1);
    // the reading must be from the last frame before this check, after the loss
    if (this.stopAt === null || !s || lastT === undefined || s.t !== lastT || s.t <= this.stopAt) return false;
    return s.v >= Math.max(this.r.pressFloor, this.r.pressRel * this.descPeak);
  }
  /** When the bar was lost on this rep: the camera's stop, else the track's loss (null while it's seen). */
  private lostFrom() { return this.stopAt ?? this.lostSince; }
  /** The late Press! 2 s after the loss (3.4b, "Lost after Start!"), with why `lost`. */
  private lostLate(t: number): BarCmd {
    this.state = 'pressed'; this.pressAt = t; this.late = true; this.lostPress = true; this.backSince = null;
    return { cmd: 'press', t, late: true, why: 'lost', ...this.heldMark() };
  }

  /**
   * Item 114 (3.2, "The time rules keep running with no frames"): the refresh tick, with no new camera frame. Runs the
   * time rules only: the 5 s void, the lost-bar void, the late "Press!" 2 s after a loss and "Rack!" 3 s after it. When
   * no frame has come for noFrameMs (500 ms), the bar counts as lost from the last frame, as a lost frame does. `t` is
   * on the frames' clock. Nothing is added to the path.
   */
  tick(t: number): BarCmd | null {
    const r = this.r, last = this.all.at(-1);
    if (this.state === 'done' || !last || t <= last.t) return null;
    const gone = t - last.t >= (r.noFrameMs ?? 500);
    if (this.startAt !== null && this.state !== 'pressed' && t - this.startAt >= r.noRepMs) { this.state = 'done'; return { cmd: 'rack', t, noRep: true, rackWhy: 'no_rep' }; }
    if (this.state === 'waiting' && this.leftAt !== null) {
      if (gone) this.lowSince ??= last.t;
      if (r.voidRule && this.lowSince !== null && t - this.lowSince >= r.lowScoreBeforeMs) {
        this.state = 'done'; this.lostBeforeStart = t; this.voidAt = t; return { cmd: 'rack', t, void: true, voidWhy: 'low_score' };
      }
      if (r.voidRule && t - this.leftAt >= r.voidMs) { this.state = 'done'; this.voidAt = t; return { cmd: 'rack', t, void: true, voidWhy: 'no_start_5s' }; }
      return null;
    }
    if (this.state === 'lifting') {
      if (gone) this.markStop(last.t);
      const from = this.lostFrom();
      if (r.stuckRule && from !== null && t - from >= r.lostLateMs && (gone || !this.seenGoingDown(last.t))) return this.lostLate(t);
      return null;
    }
    if (this.state === 'pressed' && this.lostPress && t - this.pressAt! >= r.lostRackMs) { this.state = 'done'; return { cmd: 'rack', t, rackWhy: 'lost' }; }
    if (this.state === 'pressed' && !this.lostPress) {
      if (gone) this.pressLostSince ??= last.t;
      const c = this.pressedTimeRules(t); if (c) return c;
    }
    return null;
  }

  /** After a Press! from stillness: "Rack!" 3 s after a loss (item 116), and the no-rep rule, on time: 20 s from Press! once it's called, 20 s from Start! before (3.4b; the Playner, 12:46 AM). */
  private pressedTimeRules(t: number, noRep = true): BarCmd | null {
    const r = this.r;
    if (r.stuckRule && this.pressLostSince !== null && t - this.pressLostSince >= r.lostRackMs) { this.state = 'done'; return { cmd: 'rack', t, rackWhy: 'lost' }; }
    if (noRep && t - this.pressAt! >= r.noRepMs) { this.state = 'done'; return { cmd: 'rack', t, noRep: true, rackWhy: 'no_rep' }; }
    return null;
  }

  feed(t: number, x: number, y: number, score: number): BarCmd | null {
    const r = this.r;
    const p = { t, x: x * this.aspect, y, score };
    const prev = this.all.at(-1);
    if (prev && t > prev.t) { this.gaps.push(t - prev.t); if (this.gaps.length > 60) this.gaps.shift(); }
    // item 114: a frame after a stop of noFrameMs or more; the tick may not have run in it (a hidden tab's 100 ms timer)
    const stopped = !!prev && t - prev.t >= (r.noFrameMs ?? 500);
    if (stopped) { this.markStop(prev.t); if (this.state === 'waiting' && this.leftAt !== null) this.lowSince ??= prev.t; }
    this.all.push(p);
    let ok = score >= r.lostScore;
    if (this.state === 'done') return null;
    // the tick's time rules first, at this frame's time: the frame may come after their time
    if (stopped && this.state === 'waiting' && this.leftAt !== null && r.voidRule && t - this.lowSince! >= r.lowScoreBeforeMs) {
      this.state = 'done'; this.lostBeforeStart = t; this.voidAt = t; return { cmd: 'rack', t, void: true, voidWhy: 'low_score' };
    }
    if (this.stopAt !== null && this.state === 'lifting') {
      // after a stop, "Press!" comes only lostLateMs after the last frame before it (3.2); the short-pause Rack! still runs
      if (r.stuckRule && t - this.stopAt >= r.lostLateMs && !(ok && this.seenGoingDown(prev?.t))) return this.lostLate(t);
    }
    if (this.startAt !== null && this.state !== 'pressed' && t - this.startAt >= r.noRepMs) { this.state = 'done'; return { cmd: 'rack', t, noRep: true, rackWhy: 'no_rep' }; }
    if (stopped && this.state === 'pressed' && !this.lostPress) this.pressLostSince ??= prev!.t;
    // The stuck-track rule (The Playner's 3:35 mail, plan 3.4b): a score of 0.99 or more with under 1 px of movement on the
    // frame for freezeBeforeMs / freezeAfterMs counts as lost. Off the hooks only (a racked bar is still). Before Start!: "We lost the bar.", no Start!.
    // After Start!: never Press! from stillness; if the track doesn't come back, press_late 2 s after the loss, Rack! 3 s after.
    // The window is full when its oldest point is no later than its start plus the path's median gap (The Playner's
    // 8:47 AM mail), so the rule acts the same at any camera rate or screen tick.
    const fm = this.state === 'waiting' ? r.freezeBeforeMs : r.freezeAfterMs;
    if (r.stuckRule && fm > 0 && (this.state === 'waiting' || this.state === 'lifting' || (this.state === 'pressed' && (this.lostPress || !!r.guardAfterPress))) && score >= r.freezeScore) {
      const back = this.all.filter(q => q.t >= t - fm);
      const near = this.state !== 'waiting' || !r.freezeNearTapPct || Math.hypot(p.x - this.tap.x * this.aspect, p.y - this.tap.y) <= r.freezeNearTapPct / 100;
      // item 114: a gap of noFrameMs or more ends a stuck stretch (3.2)
      const unbroken = back.every((q, i) => i === 0 || q.t - back[i - 1].t < (r.noFrameMs ?? 500));
      // item 116, `from`: after a normal Press!, stuck time counts from Press! at the earliest: the window may not reach back across it
      const afterPress = this.state !== 'pressed' || this.lostPress || r.guardAfterPress !== 'from' || t - fm >= this.pressAt!;
      const still = near && unbroken && afterPress && back.length >= 3 && back[0].t <= t - fm + this.medGap() && back.every(q => q.score >= r.freezeScore && Math.abs(q.x / this.aspect - x) * this.w < 1 && Math.abs(q.y - y) * this.h < 1);
      if (still) {
        ok = false; this.frozeAt.push(t); this.frozeFrom.push(t - fm);
        // The stuck stretch was never the bar: take it out of the history, so no stillness is read from it.
        if (this.lostSince === null) { const from = t - fm; this.hist = this.hist.filter(q => q.t < from); this.speeds = this.speeds.filter(q => q.t < from); }
      }
    }
    if (this.state === 'waiting' && this.leftAt !== null) {
      // Lost off the hooks before Start!: stuck, or under lostScore for lowScoreBeforeMs.
      this.lowSince = score < r.lostScore ? (this.lowSince ?? t) : null;
      const stuck = !ok && r.stuckRule && score >= r.freezeScore;
      const low = this.lowSince !== null && t - this.lowSince >= r.lowScoreBeforeMs;
      if (stuck || (r.voidRule && low)) {
        this.state = 'done'; this.lostBeforeStart = t;
        if (!r.voidRule) return null;
        this.voidAt = t; return { cmd: 'rack', t, void: true, voidWhy: stuck ? 'stuck' : 'low_score' };
      }
      // Off the hooks with no Start! within voidMs.
      if (r.voidRule && t - this.leftAt >= r.voidMs) { this.state = 'done'; this.voidAt = t; return { cmd: 'rack', t, void: true, voidWhy: 'no_start_5s' }; }
    }
    if (!ok && r.stuckRule && this.state === 'lifting') {
      if (this.lostSince === null) this.lostSince = this.frozeAt.at(-1) === t ? this.frozeFrom.at(-1)! : t;
      this.stopAt ??= this.lostSince; // lost once, lost for this rep's Press! (3.4b, "Lost after Start!")
      if (t - this.lostFrom()! >= r.lostLateMs) return this.lostLate(t);
      return null;
    }
    if (r.stuckRule && this.state === 'pressed' && this.lostPress) {
      if (!ok) { if (t - this.pressAt! >= r.lostRackMs) { this.state = 'done'; return { cmd: 'rack', t, rackWhy: 'lost' }; } return null; }
      this.lostPress = false; // the track came back: back to the usual back-up Rack!
    }
    if (r.stuckRule && this.state === 'pressed' && !this.lostPress) {
      // item 116: lost after a Press! from stillness (lost, stuck, or no frame): "Rack!" 3 s after the loss, unless the track
      // comes back first; a stuck stretch counts from when the guard marks it, 1.5 s in (3.4b)
      if (ok) this.pressLostSince = null; else this.pressLostSince ??= t;
      // on a seen frame the no-rep rule runs at the end of the pressed block, after the back-up Rack!
      const c = this.pressedTimeRules(t, !ok); if (c) return c;
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
      // item 114: after a camera stop, never Press! from stillness (3.2); the late Press! from the stop above
      const still = this.stopAt === null && down && this.stillFor(t, r.pressStillMs, lim, r.pressXY);
      if (still && frozen && !this.stillFor(t, r.frozenPressMs!, lim, r.pressXY)) this.held = true;
      else if (still) {
        this.state = 'pressed'; this.pressAt = t; this.late = false; this.backSince = null;
        return { cmd: 'press', t, ...this.heldMark() };
      }
      if (this.stopAt === null && p.y - this.startY! >= r.pressDown && t - this.hist[0].t >= r.lateMs && this.spread(t - r.lateMs) < r.lateStill) {
        this.state = 'pressed'; this.pressAt = t; this.late = true; this.backSince = null;
        return { cmd: 'press', t, late: true, why: 'still', ...this.heldMark() };
      }
      if (r.shortPause && this.lowY - this.startY! >= r.pressDown && p.y - this.startY! <= this.back()) {
        if (this.backSince === null) this.backSince = t;
        if (t - this.backSince >= r.rackHoldMs) { this.state = 'done'; this.shortPauseAt = t; return { cmd: 'rack', t, rackWhy: 'up' }; }
      } else this.backSince = null;
      return null;
    }
    if (this.state === 'pressed') {
      if (this.state === 'pressed') this.lowY = Math.max(this.lowY, p.y);
      if (p.y - this.startY! <= this.back()) {
        this.reachedTop = true;
        if (this.backSince === null) this.backSince = t;
        if (t - this.backSince >= r.rackHoldMs) { this.state = 'done'; return { cmd: 'rack', t, rackWhy: 'up' }; }
      } else this.backSince = null;
      // the no-rep rule on a seen frame, after the back-up Rack! (3.4b: 20 s from "Press!" with no rep); a failed rep,
      // seen on her chest or stuck halfway, ends here on "refresh" and on the server, where no tick runs
      if (t - this.pressAt! >= r.noRepMs) { this.state = 'done'; return { cmd: 'rack', t, noRep: true, rackWhy: 'no_rep' }; }
    }
    return null;
  }
}
