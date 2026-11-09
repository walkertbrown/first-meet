// One meet attempt on the phone, for any lift (plan 5.25 steps 3–7, 3.8a): find your spot, the soft
// command, then the lift's own caller. It says what to show and say, and the `command_times` key
// each command is saved under, as the server reads them (attempt.ts, COMMAND_ORDER). The phone
// doesn't judge a meet attempt; the server does, from the recording.
import type { Dims, Frame } from './pose';
import { FrameCheck, type Spot } from './frame-check';
import { DeadliftCaller, SquatCaller } from './commands';
import { BenchCaller, pressKey } from './press';
import { OverheadCaller } from './overhead';
import { RULES, type Rules } from './rules';

export type MeetLiftName = 'squat' | 'bench' | 'deadlift';
export type MeetWord = 'squat' | 'start' | 'press';

export type MeetEvent =
  | { type: 'spot'; t: number; spot: Spot }
  | { type: 'good-spot'; t: number }
  /** the soft command: "Bar is loaded." / "Weights ready."; the recording starts here */
  | { type: 'loaded'; t: number }
  /** a command she lifts on: "SQUAT!", "START!", "PRESS!" */
  | { type: 'call'; t: number; key: string; word: MeetWord }
  /** a Home rep ended (`rep_<k>`); a Home deadlift's rep says "DOWN!" */
  | { type: 'rep'; t: number; k: number; key: string; down: boolean }
  /** "RACK!" or "DOWN!"; `noRep`: she never lifted, so nothing is sent */
  | { type: 'end'; t: number; key: 'rack' | 'down'; noRep: boolean };

export type MeetPhase = 'spot' | 'good-spot' | 'loaded' | 'lifting' | 'done';

type Caller =
  | { kind: 'squat'; c: SquatCaller }
  | { kind: 'bench'; c: BenchCaller }
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
   * TryALift's).
   */
  constructor(d: Dims, readonly lift: MeetLiftName, private opts: { reps?: number | null; rules?: Rules; skipFrameCheck?: boolean } = {}) {
    this.rules = opts.rules ?? RULES;
    this.reps = opts.reps ?? 1;
    const home = !!opts.reps;
    // Home's overhead press is filmed front-on, with room above her head (3.4c)
    this.check = new FrameCheck(d, this.rules, home && lift === 'bench' ? 'front' : 'side');
    this.caller = lift === 'squat' ? { kind: 'squat', c: new SquatCaller(d, this.rules, !!opts.skipFrameCheck, this.reps) }
      : lift === 'deadlift' ? { kind: 'deadlift', c: new DeadliftCaller(d, this.rules, home ? this.reps : 1) }
      : home ? { kind: 'overhead', c: new OverheadCaller(d, this.rules, { reps: this.reps }) }
      : { kind: 'bench', c: new BenchCaller(d, this.rules) };
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
    if (this.phase === 'good-spot') {
      if (f.t - this.goodSpotAt! < this.rules.tryALift.goodSpotToStandTallMs) return out;
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
    if (k.kind === 'bench') {
      const c = k.c.feed(f);
      if (!c) return [];
      if (c.cmd === 'start') { this.phase = 'lifting'; return [{ type: 'call', t: c.t, key: 'start', word: 'start' }]; }
      if (c.cmd === 'press') return [{ type: 'call', t: c.t, key: pressKey(c.k, !!c.late), word: 'press' }];
      if (c.cmd === 'rep') return [];
      return this.end(c.t, 'rack', !!c.noRep);
    }
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
