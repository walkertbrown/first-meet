// Measuring only (branch measure/close-sides): each close-call candidate fed as the live server feeds it
// (poses.first_pass / second_pass via worker/cli.py), judged as is and with the other side made the near one.
import { describe, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { judgeAttempt, mergePasses, zoomWindows, type Frame } from '../../web/lib/judge';

const PY = process.env.WORKER_PYTHON!;
const CLI = join(__dirname, '../../worker/cli.py');
type Raw = { w: number; h: number; duration: number; secs: number; frames: Frame[] };
const runFile = (file: string, args: string[]): Raw => JSON.parse(execFileSync(PY, [CLI, file, ...args], { maxBuffer: 64 << 20, encoding: 'utf8' }));
const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], ...Array.from({ length: 11 }, (_, i) => [11 + 2 * i, 12 + 2 * i])];
const swapVis = (f: Frame): Frame => {
  if (!f.p) return f;
  const p = f.p.map(q => [...q]) as typeof f.p;
  for (const [a, b] of PAIRS) { p[a][2] = f.p[b][2]; p[b][2] = f.p[a][2]; }
  return { ...f, p };
};
const C: [string, { loaded: number; squat: number; rack: number }][] = [
  ['king-A-l567.mp4', { loaded: 0, squat: 300, rack: 2117 }],
  ['king-B-l567.mp4', { loaded: 0, squat: 300, rack: 2317 }],
  ['king-B-l400.mp4', { loaded: 0, squat: 133, rack: 2150 }],
  ['king-C-l567.mp4', { loaded: 0, squat: 300, rack: 2317 }],
  ['king-C-l400.mp4', { loaded: 0, squat: 133, rack: 2150 }],
  ['king-D-l567.mp4', { loaded: 0, squat: 300, rack: 2516 }],
  ['king-D-l400.mp4', { loaded: 0, squat: 133, rack: 2349 }],
  ['king-E-l567.mp4', { loaded: 0, squat: 300, rack: 2183 }],
  ['king-F-l567.mp4', { loaded: 0, squat: 300, rack: 2250 }],
  ['king-F-l400.mp4', { loaded: 0, squat: 133, rack: 2083 }],
  ['king-R24-l567.mp4', { loaded: 0, squat: 300, rack: 2050 }],
  ['king-committed.mp4', { loaded: 0, squat: 300, rack: 2050 }],
];
describe('sides', () => {
  for (const [file, ct] of C) {
    it(file, () => {
      const path = join(__dirname, '../../measure', file);
      const first = runFile(path, ['--pass1']);
      const zoom = zoomWindows(first.frames, first, 'squat', ct);
      const second = zoom.windows.length ? runFile(path, ['--windows', JSON.stringify(zoom.windows), ...(zoom.splitMs !== null ? ['--split', String(zoom.splitMs)] : [])]) : { frames: [], secs: 0 };
      const fr = mergePasses(first.frames, second.frames);
      const a = judgeAttempt(fr, first, 'squat', ct, undefined, 1);
      const b = judgeAttempt(fr.map(swapVis), first, 'squat', ct, undefined, 1);
      console.log('MEASURE ' + JSON.stringify({
        file, ct,
        asIs: { call: a.call, side: a.measures.side, depth: a.measures.depth, jf: a.measures.judged_frame_ms, reps: a.measures.reps },
        other: { call: b.call, side: b.measures.side, depth: b.measures.depth, jf: b.measures.judged_frame_ms },
      }));
    }, 600_000);
  }
});
