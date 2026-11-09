// A meet attempt, judged by the web service on the Workflow's pose points and the command
// times the phone recorded (plan 2.3, step 3; 3.4 "The attempt window").
import type { Dims, Frame } from './pose';
import { judgeDeadlift, judgeSquat, type AttemptResult, type Call } from './call';
import { DeadliftCaller } from './commands';
import { RULES, type Rules } from './rules';
import type { CommandTimes } from './zoom';
import { judgePress, pressTimes, type PressRep } from './press';
import { judgeOverhead, type OverheadRep } from './overhead';

export type RepLight = { call: 'white' | 'red' | 'close'; reason: string | null; frame_ms?: number };

export type MeetLift = 'squat' | 'bench' | 'deadlift';

/**
 * The commands each lift's recording has, in the order they're called. Recording starts at the soft
 * command. Home's `bench` is the overhead press (3.7): "Start!", her reps, "Rack!", and no "Press!".
 */
export const COMMAND_ORDER: Record<MeetLift, { soft: string[]; start: string | null; then: string[] }> = {
  squat: { soft: ['loaded', 'ready'], start: 'squat', then: ['rack'] },
  // a recording has `press` or, when the phone called it late (3.4), `press_late`: never both
  bench: { soft: ['loaded', 'ready'], start: 'start', then: ['press', 'press_late', 'rack'] },
  deadlift: { soft: ['loaded', 'ready'], start: null, then: ['down'] },
};

export type CommandProblem = 'missing_soft' | 'missing_start' | 'out_of_order' | 'outside_clip' | 'start_before_soft' | 'not_a_number';

/**
 * 2.3 step 3: the commands are in order, all inside the clip's length, and the start
 * command comes after the soft command. Anything else is a close call, never a white.
 * Home rep ends (`rep_1`, `rep_2`, …, 3.8a) must be inside the clip and in order too.
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
  const repNo = (k: string) => Number(/^rep_?(\d+)$/.exec(k)?.[1] ?? NaN);
  const reps = Object.keys(ct).filter(k => !Number.isNaN(repNo(k))).sort((a, b) => repNo(a) - repNo(b)).map(k => ct[k]);
  for (let i = 0; i < reps.length; i++) if (reps[i] <= (i ? reps[i - 1] : soft)) return 'out_of_order';
  return null;
}

export type AttemptVerdict = {
  /** The attempt's one call; a close call goes to a referee. */
  call: Call | { light: 'close'; reason: 'judge_unavailable' | 'command_times' };
  lights: ('white' | 'red')[] | null;
  /** Home (3.8a): every declared rep's call, in order. */
  repLights: RepLight[] | null;
  judgedFrameMs: number | null;
  measures: Record<string, unknown>;
  result: AttemptResult | null;
};

const lightsOf = (c: Call): AttemptVerdict['lights'] => (c.light === 'close' ? null : [c.light, c.light, c.light]);

/** `repsDeclared`: a Home attempt, reps at a weight (3.8a), where every declared rep is judged. */
export function judgeAttempt(frames: Frame[], d: Dims & { duration: number }, lift: MeetLift, ct: CommandTimes | null,
  rules: Rules = RULES, repsDeclared: number | null = null): AttemptVerdict {
  const durationMs = Math.round(d.duration * 1000);
  const problem = checkCommandTimes(ct, lift, durationMs);
  if (problem || !ct) {
    return { call: { light: 'close', reason: 'command_times' }, lights: null, repLights: null, judgedFrameMs: null, measures: { command_times: problem ?? 'missing_soft' }, result: null };
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
    window = { start: ct.start, end: ct.rack ?? durationMs };
    // Barbell: the bench press. Home: the overhead press (3.7), filmed front-on, every rep judged (3.4c).
    result = repsDeclared
      ? judgeOverhead(frames, d, window, rules)
      : judgePress(frames, d, window, pressTimes(ct), rules);
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
  const press = rep as (PressRep & OverheadRep) | undefined;
  if (press?.pressMs !== undefined) measures.press_ms = press.pressMs;
  if (press?.pauseMs !== undefined) measures.pause_ms = press.pauseMs;
  if (press?.riseArm !== undefined) measures.rise_arm = +press.riseArm.toFixed(3);
  if (press?.lockoutElbowDeg !== undefined) measures.lockout_elbow_deg = +press.lockoutElbowDeg.toFixed(1);
  if (repsDeclared) return homeVerdict(result, repsDeclared, measures);
  return { call: result.call, lights: lightsOf(result.call), repLights: null, judgedFrameMs: result.judgedFrameMs, measures, result };
}

/**
 * 3.8a, the call for a Home attempt: good lift when every declared rep is white; no lift when
 * any rep is red (the first red rep's reason, and its frame); otherwise a close call. Fewer reps
 * seen than declared, with none red, is a close call too ("Hard to see"): a referee counts them.
 */
function homeVerdict(result: AttemptResult, declared: number, measures: Record<string, unknown>): AttemptVerdict {
  const reps = result.reps.slice(0, declared);
  const repLights: RepLight[] = reps.map(r => ({ call: r.call.light, reason: 'reason' in r.call ? r.call.reason : null, frame_ms: r.judgedFrameMs }));
  measures.reps_declared = declared;
  measures.reps_seen = result.reps.length;
  const red = reps.findIndex(r => r.call.light === 'red');
  if (red >= 0) {
    measures.red_rep = red + 1;
    const call = reps[red].call;
    return { call, lights: lightsOf(call), repLights, judgedFrameMs: reps[red].judgedFrameMs, measures, result };
  }
  if (result.call.light === 'close' && result.call.reason === 'visibility') {
    return { call: result.call, lights: null, repLights, judgedFrameMs: result.judgedFrameMs, measures, result };
  }
  const close = reps.find(r => r.call.light === 'close');
  if (close) return { call: close.call, lights: null, repLights, judgedFrameMs: close.judgedFrameMs, measures, result };
  if (reps.length < declared) {
    const call = { light: 'close', reason: 'visibility' } as const;
    return { call, lights: null, repLights, judgedFrameMs: reps.at(-1)?.judgedFrameMs ?? null, measures, result };
  }
  const white = { light: 'white' } as const;
  return { call: white, lights: lightsOf(white), repLights, judgedFrameMs: reps.at(-1)!.judgedFrameMs, measures, result };
}
