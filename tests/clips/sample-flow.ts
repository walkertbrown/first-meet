// The sample lifts (content/samples/), run the way the stage runs them (try-lift.tsx):
// the first frame is held, sampled every 66 ms, through the frame check and "Good
// spot." and "Stand tall and still." until "Squat!"; then the clip plays, and its
// last frame is held up to 1.5 s for "Rack!". Shared by the unit test on saved poses
// and judge.spec.ts on poses found fresh in Chromium, so both check what a visitor sees.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES, TryALift, measure, nearSide, type AttemptResult, type Frame } from '../../web/lib/judge';
import { callName } from './check';

export type Sample = { id: string; kind: 'good' | 'no' | 'close'; file: string; credit: string };
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
  expect(run.call, `${s.id}: judged as its kind, ${s.kind}`).toBe(KIND_CALL[s.kind]);
}
