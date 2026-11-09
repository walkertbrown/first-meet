// The Barbell bench on the phone (plan 3.4b, look 5.14c): her tap on the plate, the plate tracker
// following it on a small grey frame, and the bar caller's "Start!", "Press!" and "Rack!". Plain TS, past
// frames only, so the unit tests run it on the same frames the stage sees.
//
// - The tap: before "Start!" only, while the bar is on the hooks. A second tap moves the mark (and the
//   tracker starts again from there). Its point and the template's size are `plate_tap`.
// - The mark follows the plate every frame until "Start!".
// - Lost on the hooks (its match score under lostScore for tapLostMs): the mark goes, "We lost the bar.",
//   and she taps again.
// - Off the hooks, the caller's own rules (bar-caller.ts): a missed start is a void "Rack!".
// - The path, for her clip's marks: every frame's point, `lost` where the score was under lostScore or the
//   caller's stuck-track rule took the stretch out (look 5.14c: the path breaks there).
import { BAR_RULES, BarCaller, type BarCmd, type BarRel } from './bar-caller';
import { BAR_TRACK, PlateTracker, type Gray, type TrackOpts } from './plate-tracker';
import type { PlateTap } from './bar-measure';

export type BarPathPoint = { t: number; x: number; y: number; lost: boolean };

export type BarStageEvent =
  /** where the mark sits now, fractions of the camera frame */
  | { type: 'mark'; t: number; x: number; y: number }
  /** lost on the hooks before "Start!": the mark goes, and she taps again */
  | { type: 'lost'; t: number }
  | ({ type: 'cmd' } & BarCmd);

export type BarStageState = 'tap' | 'racked' | 'lifting' | 'done';

export class BarStage {
  state: BarStageState = 'tap';
  plateTap: PlateTap | null = null;
  path: BarPathPoint[] = [];
  /** the void "Rack!": no "Start!" out of the rack (3.4b) */
  voided = false;
  /** the caller's commands as they came, for the clip's ticks */
  cmds: BarCmd[] = [];
  private tracker: PlateTracker | null = null;
  private caller: BarCaller | null = null;
  private lowSince: number | null = null;
  private stuckSeen = 0;

  constructor(private dims: { w: number; h: number }, private r: BarRel = BAR_RULES, private track: TrackOpts = BAR_TRACK) {}

  /** The caller, for the clip's ticks and tests. */
  get bar() { return this.caller; }

  /**
   * Her tap at (x, y), fractions of the camera frame (the footage as recorded, not the mirrored screen).
   * Taken before "Start!" while the bar is on the hooks; false otherwise.
   */
  tap(g: Gray, x: number, y: number): boolean {
    if (this.state === 'lifting' || this.state === 'done') return false;
    if (this.caller && this.caller.state !== 'racked') return false;
    const cx = Math.min(1, Math.max(0, x)), cy = Math.min(1, Math.max(0, y));
    this.tracker = new PlateTracker(g, cx, cy, this.track);
    this.caller = new BarCaller({ x: cx, y: cy }, this.dims, this.r);
    this.plateTap = { x: round4(cx), y: round4(cy), size: this.track.tpl };
    this.state = 'racked'; this.lowSince = null; this.stuckSeen = 0;
    this.path = []; this.cmds = [];
    return true;
  }

  feed(g: Gray, t: number): BarStageEvent[] {
    if (this.state === 'tap' || this.state === 'done' || !this.tracker || !this.caller) return [];
    const out: BarStageEvent[] = [];
    const m = this.tracker.track(g);
    const c = this.caller;
    const cmd = c.feed(t, m.x, m.y, m.score);
    // the stuck-track rule takes a stretch out once it sees it: those frames were never the bar
    if (c.frozeAt.length > this.stuckSeen) {
      this.stuckSeen = c.frozeAt.length;
      const from = t - this.r.freezeMs;
      for (const q of this.path) if (q.t >= from) q.lost = true;
    }
    const lost = m.score < this.r.lostScore || c.frozeAt.at(-1) === t;
    this.path.push({ t, x: m.x, y: m.y, lost });
    if (this.state === 'racked' && c.state === 'racked') {
      // lost on the hooks: under the line for tapLostMs
      this.lowSince = m.score < this.r.lostScore ? (this.lowSince ?? t) : null;
      if (this.lowSince !== null && t - this.lowSince >= this.r.tapLostMs) {
        this.state = 'tap'; this.tracker = null; this.caller = null; this.plateTap = null; this.path = [];
        out.push({ type: 'lost', t });
        return out;
      }
    }
    if (this.state === 'racked' && !lost) out.push({ type: 'mark', t, x: m.x, y: m.y });
    if (cmd) {
      this.cmds.push(cmd);
      out.push({ type: 'cmd', ...cmd });
      if (cmd.cmd === 'start') this.state = 'lifting';
      if (cmd.cmd === 'rack') { this.state = 'done'; this.voided = !!cmd.void; }
    }
    return out;
  }
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** The small grey frame's width for a w x h camera frame: BAR_FRAME_H tall, the same shape (worker/plate.py small_size). */
export const smallWidth = (w: number, h: number, frameH: number) => Math.max(1, Math.round((frameH * w) / h));
