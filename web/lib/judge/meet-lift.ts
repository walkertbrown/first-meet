// One meet attempt on the phone, for any lift (plan 5.25 steps 3–7, 3.8a): find your spot, the soft
// command, then the lift's own caller. The Barbell bench (3.4b) follows the bar, not her pose: after
// "Good spot." she taps the plate, and the bar stage (bar-stage.ts) runs on small grey frames. It says what to show and say, and the `command_times` key
// each command is saved under, as the server reads them (attempt.ts, COMMAND_ORDER). The phone
// doesn't judge a meet attempt; the server does, from the recording.
import type { Dims, Frame } from './pose';
import { FrameCheck, type Spot } from './frame-check';
import { DeadliftCaller, SquatCaller } from './commands';
import { pressKey } from './press';
import { OverheadCaller } from './overhead';
import { BarStage } from './bar-stage';
import type { Gray } from './plate-tracker';
import type { PlateTap, PressLateWhy } from './bar-measure';
import { RULES, type Rules } from './rules';

export type MeetLiftName = 'squat' | 'bench' | 'deadlift';
export type MeetWord = 'squat' | 'start' | 'press';

export type MeetEvent =
  | { type: 'spot'; t: number; spot: Spot }
  | { type: 'good-spot'; t: number }
  /** the soft command: "Bar is loaded." / "Weights ready."; the recording starts here */
  | { type: 'loaded'; t: number }
  /** the Barbell bench (3.4b): "Tap the end of the bar on your screen." */
  | { type: 'tap-ask'; t: number }
  /** the bench's bar mark, where the plate is now (fractions of the camera frame), until "Start!" */
  | { type: 'mark'; t: number; x: number; y: number }
  /** the bench lost the plate on the hooks before "Start!": "We lost the bar.", and she taps again */
  | { type: 'lost'; t: number }
  /** a command she lifts on: "SQUAT!", "START!", "PRESS!"; a bench's late "Press!" says why */
  | { type: 'call'; t: number; key: string; word: MeetWord; why?: PressLateWhy }
  /** a Home rep ended (`rep_<k>`); a Home deadlift's rep says "DOWN!" */
  | { type: 'rep'; t: number; k: number; key: string; down: boolean }
  /**
   * "RACK!" or "DOWN!"; `noRep`: she never lifted, so nothing is sent. `void`: the bench had no
   * "Start!" out of the rack (3.4b), so nothing is sent and she films it again.
   */
  | { type: 'end'; t: number; key: 'rack' | 'down'; noRep: boolean; void?: boolean };

export type MeetPhase = 'spot' | 'good-spot' | 'tap' | 'loaded' | 'lifting' | 'done';

type Caller =
  | { kind: 'squat'; c: SquatCaller }
  | { kind: 'bar'; c: BarStage }
  | { kind: 'overhead'; c: OverheadCaller }
  | { kind: 'deadlift'; c: DeadliftCaller };

export class MeetLift {
  phase: MeetPhase = 'spot';
  readonly check: FrameCheck;
  private caller: Caller;
  private goodSpotAt: number | null = null;
  private reps: number;
  private rules: Rules;

  /**
   * `reps`: a Home attempt's declared reps (3.8a); none for Barbell. Home's bench is the overhead
   * press (3.7). `skipFrameCheck`: the spot is right from the first frame (the tests' clips, as
   * TryALift's). `atTap`: the bench filmed again after a void (look 5.14c): straight to the tap.
   */
  constructor(d: Dims, readonly lift: MeetLiftName, private opts: { reps?: number | null; rules?: Rules; skipFrameCheck?: boolean; atTap?: boolean } = {}) {
    this.rules = opts.rules ?? RULES;
    this.reps = opts.reps ?? 1;
    const home = !!opts.reps;
    // Home's overhead press is filmed front-on, with room above her head (3.4c)
    this.check = new FrameCheck(d, this.rules, home && lift === 'bench' ? 'front' : 'side');
    this.caller = lift === 'squat' ? { kind: 'squat', c: new SquatCaller(d, this.rules, !!opts.skipFrameCheck, this.reps) }
      : lift === 'deadlift' ? { kind: 'deadlift', c: new DeadliftCaller(d, this.rules, home ? this.reps : 1) }
      : home ? { kind: 'overhead', c: new OverheadCaller(d, this.rules, { reps: this.reps }) }
      : { kind: 'bar', c: new BarStage(d) };
    if (opts.atTap && this.caller.kind === 'bar') this.phase = 'tap';
  }

  /** The Barbell bench follows the bar (3.4b): from the tap on, feed it grey frames (feedBar), not poses. */
  get byBar() { return this.caller.kind === 'bar'; }
  /** The bar stage wants frames: from the tap until "Rack!". */
  get wantsBar() { return this.caller.kind === 'bar' && (this.phase === 'tap' || this.phase === 'loaded' || this.phase === 'lifting'); }
  /** Her tap, while the bench takes one (before "Start!"); `plate_tap` once she has tapped. */
  get plateTap(): PlateTap | null { return this.caller.kind === 'bar' ? this.caller.c.plateTap : null; }
  get bar(): BarStage | null { return this.caller.kind === 'bar' ? this.caller.c : null; }

  /** Her tap at (x, y), fractions of the camera frame (not the mirrored screen). */
  tapBar(g: Gray, x: number, y: number): boolean {
    if (this.caller.kind !== 'bar' || !this.wantsBar) return false;
    return this.caller.c.tap(g, x, y);
  }

  /** One grey frame for the bench: the mark, lost, and the bar's commands. The first frame after her first tap is "Bar is loaded.". */
  feedBar(g: Gray, t: number): MeetEvent[] {
    const k = this.caller;
    if (k.kind !== 'bar' || !this.wantsBar) return [];
    const out: MeetEvent[] = [];
    if (this.phase === 'tap') {
      if (k.c.state !== 'racked') return out;
      this.phase = 'loaded';
      out.push({ type: 'loaded', t });
    }
    for (const e of k.c.feed(g, t)) {
      if (e.type === 'mark') out.push({ type: 'mark', t: e.t, x: e.x, y: e.y });
      else if (e.type === 'lost') out.push({ type: 'lost', t: e.t });
      else if (e.cmd === 'start') { this.phase = 'lifting'; out.push({ type: 'call', t: e.t, key: 'start', word: 'start' }); }
      else if (e.cmd === 'press') out.push({ type: 'call', t: e.t, key: pressKey(1, !!e.late), word: 'press', ...(e.late && e.why ? { why: e.why } : {}) });
      else { this.phase = 'done'; out.push({ type: 'end', t: e.t, key: 'rack', noRep: !!e.noRep, ...(e.void ? { void: true } : {}) }); }
    }
    return out;
  }

  feed(f: Frame): MeetEvent[] {
    const out: MeetEvent[] = [];
    if (this.phase === 'done') return out;
    if (this.phase === 'spot') {
      const spot = this.check.feed(f);
      out.push({ type: 'spot', t: f.t, spot });
      if (this.check.passed || this.opts.skipFrameCheck) { this.phase = 'good-spot'; this.goodSpotAt = f.t; out.push({ type: 'good-spot', t: f.t }); }
      return out;
    }
    if (this.wantsBar) return out;
    if (this.phase === 'good-spot') {
      if (f.t - this.goodSpotAt! < this.rules.tryALift.goodSpotToStandTallMs) return out;
      // the Barbell bench: "Tap the end of the bar on your screen." (3.4b); the bar stage takes it from here
      if (this.caller.kind === 'bar') { this.phase = 'tap'; out.push({ type: 'tap-ask', t: f.t }); return out; }
      this.phase = 'loaded';
      out.push({ type: 'loaded', t: f.t });
    }
    // a caller can owe a second command for the same frame (a rep, then "Rack!"): drain it
    for (let i = 0; i < 3 && (this.phase as MeetPhase) !== 'done'; i++) {
      const got = this.step(f);
      if (!got.length) break;
      out.push(...got);
    }
    return out;
  }

  private step(f: Frame): MeetEvent[] {
    const k = this.caller;
    if (k.kind === 'squat') {
      const c = k.c.feed(f);
      if (!c) return [];
      if (c.cmd === 'squat') { this.phase = 'lifting'; return [{ type: 'call', t: c.t, key: 'squat', word: 'squat' }]; }
      if (c.cmd === 'rep') return this.reps > 1 ? [{ type: 'rep', t: c.t, k: c.k, key: `rep_${c.k}`, down: false }] : [];
      return this.end(c.t, 'rack', !!c.noRep);
    }
    if (k.kind === 'bar') return [];
    if (k.kind === 'overhead') {
      const c = k.c.feed(f);
      if (!c) return [];
      if (c.cmd === 'start') { this.phase = 'lifting'; return [{ type: 'call', t: c.t, key: 'start', word: 'start' }]; }
      if (c.cmd === 'rep') return [{ type: 'rep', t: c.t, k: c.k, key: `rep_${c.k}`, down: false }];
      return this.end(c.t, 'rack', !!c.noRep);
    }
    const c = k.c.feed(f);
    if (!c) return [];
    if (c.cmd === 'start-window') { this.phase = 'lifting'; return []; }
    if (c.cmd === 'rep') {
      const rep: MeetEvent = { type: 'rep', t: c.t, k: c.k, key: `rep_${c.k}`, down: c.k < this.reps };
      return k.c.state === 'done' ? [rep, ...this.end(c.t, 'down', false)] : [rep];
    }
    // a deadlift she never locked out is still judged (red, no lockout); one she never pulled can't end
    return this.end(c.t, 'down', false);
  }

  private end(t: number, key: 'rack' | 'down', noRep: boolean): MeetEvent[] {
    this.phase = 'done';
    return [{ type: 'end', t, key, noRep }];
  }
}
