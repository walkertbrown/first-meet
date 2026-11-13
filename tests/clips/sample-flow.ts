// The sample lifts (content/samples/), run the way the stage runs them (try-lift.tsx):
// the first frame is held, sampled every 66 ms, through the frame check and "Good
// spot." and "Stand tall and still." until "Squat!"; then the clip plays, and its
// last frame is held up to 1.5 s for "Rack!". Shared by the unit test on saved poses
// and judge.spec.ts on poses found fresh in Chromium, so both check what a visitor sees.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES, TryALift, judgeAttempt, measure, nearSide, type AttemptResult, type Frame } from '../../web/lib/judge';
import { callName } from './check';

export type Sample = { id: string; kind: 'good' | 'no' | 'close'; file: string; credit: string; meet?: ServerMeet };
/** The call each kind of sample must get. */
export const KIND_CALL = { good: 'white', no: 'red:depth', close: 'close:borderline_depth' } as const;
export const SAMPLES_DIR = join(__dirname, '../../content/samples');
export const SAMPLES = (JSON.parse(readFileSync(join(SAMPLES_DIR, 'samples.json'), 'utf8')) as { clips: Sample[] }).clips;

const PAUSED_STEP_MS = 66;
const END_HOLD_MS = 1500;

export type SampleRun = {
  /** "Squat!" is called on the held first frame; the clip plays from then. */
  squatCalled: boolean;
  /** Seconds into the clip: when her knee first bends past the "went down" angle. */
  downAt: number | null;
  rackAt: number | null;
  noRep: boolean;
  clipEnd: number;
  call: string | null;
  result: AttemptResult | null;
};

/**
 * `stepMs`: the gap between the frames the judge sees. 66 ms is the stage's paused rate;
 * a device without a GPU (EaseBot's browser, an old phone) sees one every 600 ms or so.
 */
export function runSample(raw: { w: number; h: number; frames: Frame[] }, stepMs = PAUSED_STEP_MS): SampleRun {
  const d = { w: raw.w, h: raw.h };
  const tal = new TryALift(d);
  const first = raw.frames[0], last = raw.frames[raw.frames.length - 1];
  let rackAt: number | null = null, noRep = false;
  // Held on the first frame until "Squat!".
  let t = 0;
  for (; tal.phase !== 'lifting' && tal.phase !== 'done' && t < 15_000; t += stepMs) tal.feed({ t, p: first.p });
  const squatCalled = tal.phase === 'lifting';
  const none = { squatCalled, downAt: null, rackAt, noRep, clipEnd: 0, call: null, result: null };
  if (!squatCalled) return none;
  const playAt = tal.squatAt!;
  const take = (evs: ReturnType<TryALift['feed']>, at: number) => {
    for (const ev of evs) if (ev.type === 'rack') { rackAt = (at - playAt) / 1000; noRep = ev.noRep; }
  };
  let seen = -Infinity;
  for (const f of raw.frames) {
    if (tal.phase === 'done') break;
    if (f.t - seen < stepMs && f !== last) continue;
    seen = f.t;
    const at = playAt + f.t - first.t;
    take(tal.feed({ t: at, p: f.p }), at);
  }
  const end = playAt + last.t - first.t;
  for (let at = end + stepMs; tal.phase !== 'done' && at - end < END_HOLD_MS; at += stepMs) take(tal.feed({ t: at, p: last.p }), at);
  if (tal.phase !== 'done') tal.finish(end + END_HOLD_MS);
  const side = nearSide(first);
  const down = raw.frames.find(f => f.p && measure(f.p, d, side).knee_deg < RULES.squat.downKneeMaxDeg);
  return {
    squatCalled, downAt: down ? (down.t - first.t) / 1000 : null, rackAt, noRep,
    clipEnd: (last.t - first.t) / 1000, call: tal.result ? callName(tal.result.call) : null, result: tal.result,
  };
}

/** The checks on one sample: the call matches its kind, and the trim fits look 7. */
// `expect` is vitest's or Playwright's; their matcher types differ, so it is loosely typed here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function checkSample(expect: (v: unknown, msg?: string) => any, s: Sample, run: SampleRun) {
  // Look 7: at most 1.5 s before the start command, and 1 s after the rack. The clip
  // starts on "Squat!", so the lift itself must start within 1.5 s of it.
  expect(run.squatCalled, `${s.id}: "Squat!" is called on the first frame`).toBe(true);
  expect(run.downAt, `${s.id}: she goes down`).not.toBeNull();
  expect(run.downAt!, `${s.id}: she goes down within 1.5 s of "Squat!"`).toBeLessThanOrEqual(1.5);
  expect(run.rackAt, `${s.id}: "Rack!" is called`).not.toBeNull();
  expect(run.noRep, `${s.id}: a rep is seen`).toBe(false);
  expect(run.clipEnd - run.rackAt!, `${s.id}: the clip ends within 1 s of "Rack!"`).toBeLessThanOrEqual(1);
  if (s.kind === 'close') {
    const depth = run.result?.reps[0]?.depth;
    expect(closeOnTheLine(run.call, depth), `${s.id}: a close call, or ${depth} on the edge of the close band`).toBe(true);
  } else expect(run.call, `${s.id}: judged as its kind, ${s.kind}`).toBe(KIND_CALL[s.kind]);
}

export type ServerMeet = { lift: 'squat'; reps: number; command_times: Record<string, number> };
/** Try a lift plays only the good and the no lift; the close call is the server's alone (5.36). */
export const playsInTryALift = (s: Sample) => s.kind !== 'close';

/**
 * A sample the server alone judges (the close call): the server's judge on these poses with the
 * clip's stored command times, as the demo meet runs it, and the trim from those times (look 7):
 * she goes down within 1.5 s of "Squat!", and the clip ends within 1 s of "Rack!". Try a lift's
 * spot check never sees this clip (its three-quarter view would be asked to turn side-on).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function checkServerSample(expect: (v: unknown, msg?: string) => any, s: Sample,
  raw: { w: number; h: number; duration: number; frames: Frame[] }) {
  const ct = s.meet!.command_times;
  const d = { w: raw.w, h: raw.h };
  const first = raw.frames[0], last = raw.frames[raw.frames.length - 1];
  const side = nearSide(first);
  const down = raw.frames.find(f => f.t >= ct.squat && f.p && measure(f.p, d, side).knee_deg < RULES.squat.downKneeMaxDeg);
  expect(down, `${s.id}: she goes down after "Squat!"`).toBeTruthy();
  expect((down!.t - ct.squat) / 1000, `${s.id}: she goes down within 1.5 s of "Squat!"`).toBeLessThanOrEqual(1.5);
  expect(ct.rack, `${s.id}: "Rack!" is inside the clip`).toBeLessThanOrEqual(last.t + 100);
  expect((last.t - ct.rack) / 1000, `${s.id}: the clip ends within 1 s of "Rack!"`).toBeLessThanOrEqual(1);
  const v = judgeAttempt(raw.frames, raw, 'squat', ct, undefined, s.meet!.reps);
  const call = v.call.light === 'white' ? 'white' : `${v.call.light}:${v.call.reason}`;
  const depth = v.measures.depth as number | undefined;
  expect(closeOnTheLine(call, depth), `${s.id}: the server's judge calls ${call} at depth ${depth}`).toBe(true);
}

/**
 * The close-call sample is only ever judged by the server (5.36: the demo meet's sample path;
 * Try a lift never plays it), and a candidate counts only if the server's judge calls it a close
 * call (5.36), which tests/worker/worker.test.ts checks on the worker's own points. Chromium's
 * points read depth a little differently (the Pexels 8837118 cut: -0.101 here, -0.073 on the
 * worker), so on Chromium's points the clip must be a close call or within ON_THE_LINE of the
 * close band's edges, never a clear white or a clear red.
 */
export const ON_THE_LINE = 0.02;
export function closeOnTheLine(call: string | null, depth: number | undefined): boolean {
  if (call === KIND_CALL.close) return true;
  if (depth === undefined || (call !== 'red:depth' && call !== 'white')) return false;
  const r = RULES.squat;
  return depth >= r.redDepthMax - ON_THE_LINE && depth <= r.whiteDepthMin + ON_THE_LINE;
}
