// Judge a whole recorded clip's pose points the way the phone would have, live.
// Used by the judge tests on tests/clips/ (and, from phase 2, on the Workflow's points).
import type { Dims, Frame } from './pose';
import { frameCheckClip } from './frame-check';
import { DeadliftCaller } from './commands';
import { judgeDeadlift, type AttemptResult } from './call';
import { TryALift } from './try-a-lift';
import { RULES, type Rules } from './rules';

export type ClipVerdict = {
  frameCheck: ReturnType<typeof frameCheckClip>;
  windowStart: number | null;
  result: AttemptResult | null;
};

export type ClipOptions = { rules?: Rules; skipFrameCheck?: boolean };

/**
 * `skipFrameCheck` judges the clip as if the spot were right from the first frame. Only
 * the frame check is skipped: every judging rule, the judged-frame visibility rule
 * included, runs as written.
 */
export function judgeClip(frames: Frame[], d: Dims, lift: 'squat' | 'deadlift', opts: ClipOptions = {}): ClipVerdict {
  const rules = opts.rules ?? RULES;
  const fc = frameCheckClip(frames, d, rules);
  if (!fc.passed && !opts.skipFrameCheck) return { frameCheck: fc, windowStart: null, result: null };
  const end = frames[frames.length - 1]?.t ?? 0;
  if (lift === 'squat') {
    const s = new TryALift(d, { multiRep: true, skipFrameCheck: opts.skipFrameCheck, rules });
    for (const f of frames) s.feed(f);
    if (s.squatAt === null) return { frameCheck: fc, windowStart: null, result: null };
    s.finish(end);
    return { frameCheck: fc, windowStart: s.squatAt, result: s.result };
  }
  // deadlift: the spot passes, then "Bar is loaded." starts the baseline
  const caller = new DeadliftCaller(d, rules);
  for (const f of frames) {
    if (!opts.skipFrameCheck && fc.passedAt !== null && f.t < fc.passedAt) continue;
    caller.feed(f);
    if (caller.windowAt !== null) break;
  }
  if (caller.windowAt === null) return { frameCheck: fc, windowStart: null, result: null };
  return { frameCheck: fc, windowStart: caller.windowAt, result: judgeDeadlift(frames, d, { start: caller.windowAt, end }, rules) };
}
