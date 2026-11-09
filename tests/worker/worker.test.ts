// The Workflow's pose finder (worker/, Python MediaPipe) on the six test clips, through
// the one judge, in its two passes (plan 2.3, piece 6). Run by CI's worker job:
//   WORKER_PYTHON=python npx vitest run -c tests/worker/vitest.config.ts
// Needs Python with worker/requirements.txt installed.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIPS_DIR, EXPECTED, checkClip, verdictOf } from '../clips/check';
import { zoomWindows, type Frame } from '../../web/lib/judge';

const PY = process.env.WORKER_PYTHON;
const CLI = join(__dirname, '../../worker/cli.py');
type Raw = { w: number; h: number; duration: number; secs: number; frames: Frame[] };

const run = (clip: string, args: string[]): Raw =>
  JSON.parse(execFileSync(PY!, [CLI, join(CLIPS_DIR, `${clip}.webm`), ...args], { maxBuffer: 64 << 20, encoding: 'utf8' }));

const grid15 = (duration: number, [a, b]: [number, number]) => {
  const out: number[] = [];
  for (let k = 0; k / 15 < duration - 0.02; k++) { const ms = Math.round(k * 1000 / 15); if (ms >= a && ms <= b) out.push(ms); }
  return out;
};

const timings: Record<string, unknown> = {};

describe.skipIf(!PY)('the worker finds poses that give the expected calls', () => {
  for (const [name, e] of EXPECTED) {
    it(name, () => {
      const first = run(name, ['--fps', '5']);
      const zoom = zoomWindows(first.frames, first, e.lift);
      const have = new Set(first.frames.map(f => f.t));
      const times = [...new Set(zoom.windows.flatMap(w => grid15(first.duration, w)))].filter(t => !have.has(t)).sort((a, b) => a - b);
      const second = times.length ? run(name, ['--times', times.join(','), ...(zoom.splitMs !== null ? ['--split', String(zoom.splitMs)] : [])]) : { frames: [], secs: 0 };
      const frames = [...first.frames, ...second.frames].sort((a, b) => a.t - b.t);
      timings[name] = { duration: +first.duration.toFixed(1), frames: frames.length, pass1: first.secs, pass2: second.secs };
      checkClip(expect, { ...first, frames }, e);
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
  it('writes the timings', () => {
    const out = process.env.WORKER_TIMINGS;
    if (out) writeFileSync(out, JSON.stringify(timings, null, 2));
    console.log(JSON.stringify(timings, null, 2));
  });
});
