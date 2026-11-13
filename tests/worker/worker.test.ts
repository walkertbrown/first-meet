// The Workflow's pose finder (worker/, Python MediaPipe) on the six test clips, through
// the one judge, in its two passes (plan 2.3, piece 6). Run by CI's worker job:
//   WORKER_PYTHON=python npx vitest run -c tests/worker/vitest.config.ts
// Needs Python with worker/requirements.txt installed.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CLIPS_DIR, EXPECTED, checkClip, verdictOf } from '../clips/check';
import { RULES, judgeAttempt, mergePasses, zoomWindows, type Frame } from '../../web/lib/judge';
import samples from '../../content/samples/samples.json';

const PY = process.env.WORKER_PYTHON;
const CLI = join(__dirname, '../../worker/cli.py');
const MAKE = join(__dirname, '../../worker/timing_clip.py');
type Raw = { w: number; h: number; duration: number; secs: number; frames: Frame[] };

const runFile = (file: string, args: string[]): Raw =>
  JSON.parse(execFileSync(PY!, [CLI, file, ...args], { maxBuffer: 64 << 20, encoding: 'utf8' }));
const run = (clip: string, args: string[]) => runFile(join(CLIPS_DIR, `${clip}.webm`), args);

const grid15 = (duration: number, [a, b]: [number, number]) => {
  const out: number[] = [];
  for (let k = 0; k / 15 < duration - 0.02; k++) { const ms = Math.round(k * 1000 / 15); if (ms >= a && ms <= b) out.push(ms); }
  return out;
};

const timings: Record<string, unknown> = {};
// The other side made the near one: each left/right landmark pair swaps its visibility, so the
// judge's nearSide (the higher summed visibility) picks the far side and measures from it.
const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], ...Array.from({ length: 11 }, (_, i) => [11 + 2 * i, 12 + 2 * i])];
const otherSide = (f: Frame): Frame => {
  if (!f.p) return f;
  const p = f.p.map(q => [...q]) as typeof f.p;
  for (const [a, b] of PAIRS) { p[a][2] = f.p[b][2]; p[b][2] = f.p[a][2]; }
  return { ...f, p };
};

// The six test clips of piece 1 are checked. half-squat-whole is the whole video one of
// them is cut from, kept so a change to the judge shows up; its dark last minute is where
// Python's and Chromium's MediaPipe part ways, so on the worker it is logged, not checked.
const LOGGED_ONLY = new Set(['half-squat-whole']);

describe.skipIf(!PY)('the worker finds poses that give the expected calls', () => {
  for (const [name, e] of EXPECTED) {
    it(name, () => {
      const first = run(name, ['--fps', '5']);
      const zoom = zoomWindows(first.frames, first, e.lift);
      const times = [...new Set(zoom.windows.flatMap(w => grid15(first.duration, w)))].sort((a, b) => a - b);
      const second = times.length ? run(name, ['--times', times.join(','), ...(zoom.splitMs !== null ? ['--split', String(zoom.splitMs)] : [])]) : { frames: [], secs: 0 };
      const frames = mergePasses(first.frames, second.frames);
      const v = verdictOf({ ...first, frames }, e);
      timings[name] = { duration: +first.duration.toFixed(1), frames: first.frames.length + second.frames.length, pass1: first.secs, pass2: second.secs, calls: e.skipped ? v.skipped : v.reps };
      if (!LOGGED_ONLY.has(name)) checkClip(expect, { ...first, frames }, e);
      // piece 6 (item 94): a clip that passes the frame check's side-on part gives the same calls
      // from both sides, the far side forced. 2.3 has no tie rule; this is what holds it.
      if (e.frameCheck === 'pass') {
        const w = verdictOf({ ...first, frames: frames.map(otherSide) }, e);
        timings[`${name}, other side`] = { calls: w.reps };
        expect(w.reps, `${name}: the far side's calls`).toEqual(v.reps);
        expect(w.reps).toEqual(e.reps);
      }
    }, 600_000);
  }
  // What the two passes add to any difference: one unbroken 15 fps pass, set against the
  // Chromium points saved in tests/clips/poses/ (logged, not checked).
  for (const [name, e] of EXPECTED) {
    it(`${name}: one 15 fps pass against Chromium's points`, () => {
      const one = run(name, ['--fps', '15']);
      const saved = JSON.parse(readFileSync(join(CLIPS_DIR, 'poses', `${name}.json`), 'utf8')) as Raw;
      const byT = new Map(saved.frames.map(f => [f.t, f.p]));
      let n = 0, sum = 0, max = 0, onlyPy = 0, onlyWeb = 0;
      for (const f of one.frames) {
        const s = byT.get(f.t);
        if (!f.p !== !s) { if (f.p) onlyPy++; else onlyWeb++; continue; }
        if (!f.p || !s) continue;
        for (let i = 11; i < 33; i++) { const d = Math.hypot(f.p[i][0] - s[i][0], f.p[i][1] - s[i][1]); sum += d; n++; if (d > max) max = d; }
      }
      const v = verdictOf(one, e), w = verdictOf(saved, e);
      timings[`${name} (one pass)`] = {
        frames: one.frames.length, savedFrames: saved.frames.length, meanPointGap: +(sum / Math.max(n, 1)).toFixed(4), maxPointGap: +max.toFixed(4),
        onlyPython: onlyPy, onlyChromium: onlyWeb, sameCalls: JSON.stringify(e.skipped ? v.skipped : v.reps) === JSON.stringify(e.skipped ? w.skipped : w.reps),
        calls: e.skipped ? v.skipped : v.reps,
      };
    }, 600_000);
  }
  // The speed target's two clips (plan 2.3, piece 6): a 30 s Barbell clip and a 20-rep,
  // 90 s Home clip, made by worker/timing_clip.py the way a phone records. Timing only.
  for (const name of ['timing-barbell-30s', 'timing-home-90s']) {
    it(`${name}: two passes, for timing`, () => {
      const file = join(tmpdir(), `${name}.mp4`);
      const t0 = Date.now();
      execFileSync(PY!, [MAKE, name, file]);
      const makeSecs = (Date.now() - t0) / 1000;
      const first = runFile(file, ['--fps', '5']);
      const zoom = zoomWindows(first.frames, first, 'squat');
      const times = [...new Set(zoom.windows.flatMap(w => grid15(first.duration, w)))].sort((a, b) => a - b);
      const second = times.length ? runFile(file, ['--times', times.join(','), ...(zoom.splitMs !== null ? ['--split', String(zoom.splitMs)] : [])]) : { frames: [], secs: 0 };
      const v = verdictOf({ ...first, frames: mergePasses(first.frames, second.frames) }, { lift: 'squat', frameCheck: 'pass', skipped: [] } as never);
      timings[name] = { makeSecs, pass1Frames: first.frames.length, pass1: first.secs, pass2Frames: second.frames.length, pass2: second.secs, windows: zoom.windows.length, reps: v.skipped.length };
      expect(first.duration).toBeGreaterThan(29);
    }, 600_000);
  }
  // The demo meet's sample lifts go through the server (5.36): the worker's two passes, then the
  // judge with the clip's stored command times. A close call is judged on the line, where
  // Python's and Chromium's points part ways (the Pexels 5025965 cut was a close call on
  // Chromium's points, depth 0.008, and a white on the worker's, 0.077), so it is checked here.
  // And it must sit well inside the band: staging's judge read the Pexels 8837118 cut at -0.087
  // and -0.121 on two runs of the same file (GitHub's worker: -0.073), so a close call within
  // CLOSE_MARGIN of the band's edges is a red or a white on some machine.
  // The margin is the clip's own spread across machines, with room. The Amanda King box squat, fed as
  // the live server feeds it, read -0.067 here (65f8dc5) and -0.063 to -0.084 on 40 staging runs, all
  // close calls: at most 0.017 from CI's reading. 0.04 came from the 8837118 cut's 0.034 over two runs,
  // a different clip; this one sits 0.033 inside the red edge (The Playner told, 13 Nov).
  const CLOSE_MARGIN = 0.03;
  for (const s of samples.clips) {
    it(`demo sample ${s.id}: on the worker's points it is a ${s.kind === 'good' ? 'good lift' : s.kind === 'no' ? 'no lift' : 'close call'}`, () => {
      const file = join(__dirname, '../../content/samples', s.file);
      const ct = s.meet.command_times;
      // fed exactly as the live server feeds it (worker/main.py's two passes, through poses.first_pass and
      // poses.second_pass): pass 1 split halfway, as staging does. Run unsplit, the close call's deepest frame
      // came out 1200 ms here and 1000 ms on all 40 of staging's runs (The Playner, 13 Nov).
      const first = runFile(file, ['--pass1']);
      const zoom = zoomWindows(first.frames, first, 'squat', ct);
      const second = zoom.windows.length ? runFile(file, ['--windows', JSON.stringify(zoom.windows), ...(zoom.splitMs !== null ? ['--split', String(zoom.splitMs)] : [])]) : { frames: [], secs: 0 };
      const frames = mergePasses(first.frames, second.frames);
      const v = judgeAttempt(frames, first, 'squat', ct, undefined, s.meet.reps);
      timings[`sample ${s.id}`] = { call: v.call, measures: v.measures };
      const light = ({ good: 'white', no: 'red', close: 'close' } as Record<string, string>)[s.kind];
      expect(v.call.light).toBe(light);
      // the stage holds the sample's saved judged frame before the call (samples.json): it must be the
      // worker's, within one frame of the second pass's 15 fps grid, so a re-cut sample can't drift
      const saved = (s as { judged_frame_ms?: number }).judged_frame_ms;
      expect(saved, `sample ${s.id}: judged_frame_ms in samples.json`).toBeTypeOf('number');
      expect(Math.abs(v.measures.judged_frame_ms! - saved!), `sample ${s.id}: saved ${saved} ms, the worker's ${v.measures.judged_frame_ms} ms`).toBeLessThanOrEqual(Math.ceil(1000 / 15));
      // and from both sides, the far side forced (piece 6, item 94): the same call, its `kind`. The
      // 8837221 cut's sides were nearly tied, and its far side read a white.
      const w = judgeAttempt(frames.map(otherSide), first, 'squat', ct, undefined, s.meet.reps);
      timings[`sample ${s.id}, other side`] = { call: w.call, measures: w.measures };
      expect(w.measures.side).not.toBe(v.measures.side);
      expect(w.call.light, `sample ${s.id}: the ${w.measures.side} side's call`).toBe(light);
      if (s.kind === 'close') {
        for (const x of [v, w]) {
          const d = x.measures.depth!;
          expect(x.call.light, `the ${x.measures.side} side's call`).toBe('close');
          // depth, not "hard to see": a `visibility` close call would show "Hard to see" on the referee's side
          expect(x.call.reason, `the ${x.measures.side} side's reason`).toBe('borderline_depth');
          expect(d, `the close call's depth ${d} (${x.measures.side} side) is ${CLOSE_MARGIN} inside the band`).toBeGreaterThanOrEqual(RULES.squat.redDepthMax + CLOSE_MARGIN);
          expect(d).toBeLessThanOrEqual(RULES.squat.whiteDepthMin - CLOSE_MARGIN);
        }
      }
    }, 600_000);
  }
  it('writes the timings', () => {
    const out = process.env.WORKER_TIMINGS;
    if (out) writeFileSync(out, JSON.stringify(timings, null, 2));
    console.log(JSON.stringify(timings, null, 2));
  });
});
