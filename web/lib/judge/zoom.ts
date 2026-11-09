// Where the Workflow's second pass looks (plan 2.3, "Two passes").
// The first pass finds poses 5 times a second over the whole clip; the one judge reads
// those and names each rep's start, bottom (or lockout) and end. The second pass finds
// poses 15 times a second within ZOOM_MS of each of those and of each command.
// The worker never judges: it asks the web service, which calls this.
import { measure, type Dims, type Frame } from './pose';
import { judgeClip } from './clip';
import type { RepResult } from './call';
import type { Rules } from './rules';

export const ZOOM_MS = 700;
/**
 * A squat's deepest frame can fall between two first-pass frames, and depth is noisy, so
 * the second pass also looks around each rep's next-deepest first-pass frames.
 */
export const BOTTOM_CANDIDATES = 3;

export type CommandTimes = Record<string, number>;
export type Zoom = {
  /** [from, to] ms, merged and sorted. */
  windows: [number, number][];
  /** Where the second pass splits in two (one half per CPU), or null to run it whole. */
  splitMs: number | null;
};

const merge = (spans: [number, number][]): [number, number][] => {
  const out: [number, number][] = [];
  for (const s of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
};

/**
 * `lift` is the attempt's lift. With no `commandTimes` (the Commons test clips), the
 * start command is the one the judge finds itself, the way the phone would have.
 */
export function zoomWindows(frames: Frame[], d: Dims, lift: 'squat' | 'deadlift', commandTimes: CommandTimes = {}, rules?: Rules): Zoom {
  const end = frames[frames.length - 1]?.t ?? 0;
  // Judged as written, and with the frame check skipped, so a clip the frame check
  // turns away still gets its reps found the same way at 15 a second.
  const verdicts = [judgeClip(frames, d, lift, { rules }), judgeClip(frames, d, lift, { rules, skipFrameCheck: true })];
  const reps: RepResult[] = [];
  const marks: number[] = Object.values(commandTimes).filter(t => Number.isFinite(t));
  let startCmd: number | null = commandTimes.squat ?? commandTimes.start ?? null;
  for (const v of verdicts) {
    if (v.windowStart !== null) { marks.push(v.windowStart); startCmd ??= v.windowStart; }
    for (const r of v.result?.reps ?? []) {
      reps.push(r);
      marks.push(r.startMs, r.judgedFrameMs);
      if (r.endMs !== undefined) marks.push(r.endMs);
      if (lift === 'squat' && v.result) {
        const side = v.result.side, until = r.endMs ?? end;
        frames.filter(f => f.p && f.t >= r.startMs && f.t <= until)
          .map(f => ({ t: f.t, depth: measure(f.p!, d, side).depth }))
          .sort((a, b) => b.depth - a.depth)
          .slice(0, BOTTOM_CANDIDATES)
          .forEach(c => marks.push(c.t));
      }
    }
  }
  const windows = merge(marks.map(t => [Math.max(0, t - ZOOM_MS), Math.min(end, t + ZOOM_MS)] as [number, number]));
  return { windows, splitMs: splitAt(windows, uniqueReps(reps), startCmd) };
}

const uniqueReps = (reps: RepResult[]) => {
  const seen = new Set<number>();
  return reps.filter(r => !seen.has(r.judgedFrameMs) && seen.add(r.judgedFrameMs)).sort((a, b) => a.startMs - b.startMs);
};

/**
 * The rep boundary nearest the middle of the second pass's frames; for one rep, halfway
 * between the start command and the bottom. Never within ZOOM_MS of a call.
 */
export function splitAt(windows: [number, number][], reps: RepResult[], startCmd: number | null): number | null {
  const total = windows.reduce((s, [a, b]) => s + (b - a), 0);
  if (!total) return null;
  let left = total / 2, middle = windows[0][0];
  for (const [a, b] of windows) {
    if (left <= b - a) { middle = a + left; break; }
    left -= b - a;
  }
  const candidates: number[] = [];
  for (let i = 0; i + 1 < reps.length; i++) {
    const a = reps[i].endMs ?? reps[i].judgedFrameMs, b = reps[i + 1].startMs;
    candidates.push(Math.round((a + b) / 2));
  }
  if (reps.length === 1 && startCmd !== null) candidates.push(Math.round((startCmd + reps[0].judgedFrameMs) / 2));
  const calls = reps.map(r => r.judgedFrameMs);
  const ok = candidates.filter(c => calls.every(t => Math.abs(c - t) >= ZOOM_MS));
  if (!ok.length) return null;
  return ok.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0];
}

/**
 * The two passes as one clip: pass 2's point wherever both passes have a frame (pass 2
 * found its windows in one unbroken run, as the phone does), pass 1's everywhere else.
 */
export function mergePasses(first: Frame[], second: Frame[]): Frame[] {
  const byT = new Map(first.map(f => [f.t, f]));
  for (const f of second) byT.set(f.t, f);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}
