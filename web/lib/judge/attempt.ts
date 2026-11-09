// A meet attempt, judged by the web service on the Workflow's pose points and the command
// times the phone recorded (plan 2.3, step 3; 3.4 "The attempt window").
import type { Dims, Frame } from './pose';
import { judgeDeadlift, judgeSquat, type AttemptResult, type Call } from './call';
import { DeadliftCaller } from './commands';
import { RULES, type Rules } from './rules';
import type { CommandTimes } from './zoom';

export type MeetLift = 'squat' | 'bench' | 'deadlift';

/** The commands each lift's recording has, in the order they're called. Recording starts at the soft command. */
export const COMMAND_ORDER: Record<MeetLift, { soft: string[]; start: string | null; then: string[] }> = {
  squat: { soft: ['loaded', 'ready'], start: 'squat', then: ['rack'] },
  bench: { soft: ['loaded', 'ready'], start: 'start', then: ['press', 'rack'] },
  deadlift: { soft: ['loaded', 'ready'], start: null, then: ['down'] },
};

export type CommandProblem = 'missing_soft' | 'missing_start' | 'out_of_order' | 'outside_clip' | 'start_before_soft' | 'not_a_number';

/**
 * 2.3 step 3: the commands are in order, all inside the clip's length, and the start
 * command comes after the soft command. Anything else is a close call, never a white.
 * Home rep ends (`rep1`, `rep2`, …) must be inside the clip and in order too.
 */
export function checkCommandTimes(ct: CommandTimes | null | undefined, lift: MeetLift, durationMs: number): CommandProblem | null {
  if (!ct || typeof ct !== 'object') return 'missing_soft';
  for (const v of Object.values(ct)) if (typeof v !== 'number' || !Number.isFinite(v)) return 'not_a_number';
  for (const v of Object.values(ct)) if (v < 0 || v > durationMs) return 'outside_clip';
  const o = COMMAND_ORDER[lift];
  const softKey = o.soft.find(k => k in ct);
  if (softKey === undefined) return 'missing_soft';
  const soft = ct[softKey];
  if (o.start !== null) {
    if (!(o.start in ct)) return 'missing_start';
    if (ct[o.start] <= soft) return 'start_before_soft';
  }
  const seq = [soft, ...(o.start ? [ct[o.start]] : []), ...o.then.filter(k => k in ct).map(k => ct[k])];
  for (let i = 1; i < seq.length; i++) if (seq[i] <= seq[i - 1]) return 'out_of_order';
  const reps = Object.keys(ct).filter(k => /^rep\d+$/.test(k)).sort((a, b) => +a.slice(3) - +b.slice(3)).map(k => ct[k]);
  for (let i = 0; i < reps.length; i++) if (reps[i] <= (i ? reps[i - 1] : soft)) return 'out_of_order';
  return null;
}

export type AttemptVerdict = {
  /** The attempt's one call; a close call goes to a referee. */
  call: Call | { light: 'close'; reason: 'judge_unavailable' };
  lights: ('white' | 'red')[] | null;
  judgedFrameMs: number | null;
  measures: Record<string, unknown>;
  result: AttemptResult | null;
};

const lightsOf = (c: Call): AttemptVerdict['lights'] => (c.light === 'close' ? null : [c.light, c.light, c.light]);

export function judgeAttempt(frames: Frame[], d: Dims & { duration: number }, lift: MeetLift, ct: CommandTimes | null, rules: Rules = RULES): AttemptVerdict {
  const durationMs = Math.round(d.duration * 1000);
  const problem = checkCommandTimes(ct, lift, durationMs);
  if (problem || !ct) {
    return { call: { light: 'close', reason: 'judge_unavailable' }, lights: null, judgedFrameMs: null, measures: { command_times: problem ?? 'missing_soft' }, result: null };
  }
  const soft = ct.loaded ?? ct.ready;
  let result: AttemptResult;
  let window: { start: number; end: number };
  if (lift === 'squat') {
    window = { start: ct.squat, end: ct.rack ?? durationMs };
    result = judgeSquat(frames, d, window, rules);
  } else if (lift === 'deadlift') {
    // No start command: the window starts where the hip rises above its "Bar is loaded." place.
    const caller = new DeadliftCaller(d, rules);
    for (const f of frames) {
      if (f.t < soft) continue;
      caller.feed(f);
      if (caller.windowAt !== null) break;
    }
    const end = ct.down ?? durationMs;
    if (caller.windowAt === null || caller.windowAt >= end) {
      result = { call: { light: 'red', reason: 'no_lockout' }, judgedFrameMs: null, reps: [], side: 'left', lowVisShare: 0, noRep: true };
      window = { start: soft, end };
    } else {
      window = { start: caller.windowAt, end };
      result = judgeDeadlift(frames, d, window, rules);
    }
  } else {
    // The press judge comes with the bench and floor press (phase 3); until then a referee decides.
    return { call: { light: 'close', reason: 'judge_unavailable' }, lights: null, judgedFrameMs: null, measures: { lift: 'press not judged yet' }, result: null };
  }
  const rep = result.reps[0];
  const measures: Record<string, unknown> = {
    window_ms: [window.start, window.end],
    side: result.side,
    low_visibility_share: +result.lowVisShare.toFixed(3),
    judged_frame_ms: result.judgedFrameMs,
    reps: result.reps.length,
  };
  if (rep?.depth !== undefined) measures.depth = +rep.depth.toFixed(3);
  if (rep?.bottomKneeDeg !== undefined) measures.bottom_knee_deg = +rep.bottomKneeDeg.toFixed(1);
  if (rep?.lockoutHipDeg !== undefined) measures.lockout_hip_deg = +rep.lockoutHipDeg.toFixed(1);
  if (rep?.lockoutKneeDeg !== undefined) measures.lockout_knee_deg = +rep.lockoutKneeDeg.toFixed(1);
  return { call: result.call, lights: lightsOf(result.call), judgedFrameMs: result.judgedFrameMs, measures, result };
}
