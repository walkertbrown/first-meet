// Lists every rep the judge calls on a whole test clip, with the frame check skipped:
// npx tsx scripts/clip-reps.ts <pose-json> <squat|deadlift>
import { readFileSync } from 'node:fs';
import { judgeClip } from '../web/lib/judge';

const [file, lift = 'squat'] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(file, 'utf8'));
const v = judgeClip(raw.frames, { w: raw.w, h: raw.h }, lift as 'squat' | 'deadlift', { skipFrameCheck: true });
console.log(`window from ${v.windowStart} ms, side ${v.result?.side}, low-visibility share ${v.result?.lowVisShare.toFixed(2)}`);
for (const r of v.result?.reps ?? []) {
  const c = r.call.light === 'white' ? 'white' : `${r.call.light} ${'reason' in r.call ? r.call.reason : ''}`;
  console.log(`starts ${(r.startMs / 1000).toFixed(2)} s, judged ${(r.judgedFrameMs / 1000).toFixed(2)} s  ${c.padEnd(18)} depth ${r.depth?.toFixed(2) ?? '-'}  knee ${r.bottomKneeDeg?.toFixed(0) ?? '-'}°`);
}
