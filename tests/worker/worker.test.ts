// The Workflow's pose finder (worker/, Python MediaPipe) on the six test clips, through
// the one judge, in its two passes (plan 2.3, piece 6). Run by CI's worker job:
//   WORKER_PYTHON=python npx vitest run -c tests/worker/vitest.config.ts
// Needs Python with worker/requirements.txt installed.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIPS_DIR, EXPECTED, checkClip } from '../clips/check';
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
  it('writes the timings', () => {
    const out = process.env.WORKER_TIMINGS;
    if (out) writeFileSync(out, JSON.stringify(timings, null, 2));
    console.log(JSON.stringify(timings, null, 2));
  });
});
