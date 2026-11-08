// Try a lift, as a pure state machine over pose frames (plan 5.2 steps 3–4).
// The stage feeds it frames from the camera or a sample clip and draws what it says.
// The same machine runs in the tests on tests/clips/, so the phone's flow is tested
// exactly as it runs.
import type { Dims, Frame } from './pose';
import { FrameCheck, type Spot } from './frame-check';
import { SquatCaller } from './commands';
import { judgeSquat, type AttemptResult } from './call';
import { RULES, type Rules } from './rules';

export type TryEvent =
  | { type: 'spot'; t: number; spot: Spot }
  | { type: 'good-spot'; t: number }
  | { type: 'stand-tall'; t: number }
  | { type: 'squat'; t: number }
  | { type: 'rack'; t: number; noRep: boolean }
  | { type: 'result'; t: number; result: AttemptResult };

export type TryPhase = 'spot' | 'good-spot' | 'stand-tall' | 'lifting' | 'done';

export class TryALift {
  phase: TryPhase = 'spot';
  readonly frames: Frame[] = [];
  readonly check: FrameCheck;
  private caller: SquatCaller;
  goodSpotAt: number | null = null;
  standTallAt: number | null = null;
  squatAt: number | null = null;
  rackAt: number | null = null;
  result: AttemptResult | null = null;

  /**
   * `multiRep` keeps judging after the first rep until the clip ends (the tests' many-rep clips).
   * `skipFrameCheck` treats the spot as right from the first frame (plan 3.4, piece 1: the
   * 3/4 test clips are judged with the check skipped). The check still runs, for the record.
   */
  constructor(private d: Dims, private opts: { multiRep?: boolean; skipFrameCheck?: boolean; rules?: Rules } = {}) {
    const rules = opts.rules ?? RULES;
    this.check = new FrameCheck(d, rules);
    this.caller = new SquatCaller(d, rules, !!opts.skipFrameCheck);
  }

  private get rules() { return this.opts.rules ?? RULES; }

  feed(f: Frame): TryEvent[] {
    const out: TryEvent[] = [];
    if (this.phase === 'done') return out;
    if (this.phase !== 'spot') this.frames.push(f);
    if (this.phase === 'spot') {
      const spot = this.check.feed(f);
      out.push({ type: 'spot', t: f.t, spot });
      if (this.check.passed || this.opts.skipFrameCheck) {
        this.phase = 'good-spot'; this.goodSpotAt = f.t;
        out.push({ type: 'good-spot', t: f.t });
      }
      return out;
    }
    if (this.phase === 'good-spot') {
      if (f.t - this.goodSpotAt! >= this.rules.tryALift.goodSpotToStandTallMs) {
        this.phase = 'stand-tall'; this.standTallAt = f.t;
        out.push({ type: 'stand-tall', t: f.t });
      } else return out;
    }
    const c = this.caller.feed(f);
    if (c?.cmd === 'squat') { this.phase = 'lifting'; this.squatAt = c.t; out.push({ type: 'squat', t: c.t }); }
    if (c?.cmd === 'rack') {
      this.rackAt = c.t;
      out.push({ type: 'rack', t: c.t, noRep: !!c.noRep });
      if (!this.opts.multiRep) out.push(this.finish(c.t));
    }
    return out;
  }

  /** Judge what was seen. Called on "Rack!", or at the clip's end in multi-rep mode. */
  finish(t: number): TryEvent {
    const end = this.opts.multiRep ? t : (this.rackAt ?? t);
    this.result = this.squatAt === null
      ? null
      : judgeSquat(this.frames, this.d, { start: this.squatAt, end }, this.rules);
    this.phase = 'done';
    return { type: 'result', t, result: this.result! };
  }
}
