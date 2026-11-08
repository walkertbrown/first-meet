// Prints a clip's measures every few frames, to tune rules.json by eye.
// npx tsx scripts/clip-trace.ts tests/clips/poses/<clip>.json [every]
import { readFileSync } from 'node:fs';
import { checkSpot, measure, nearSide, judgeClip, type Frame } from '../web/lib/judge';
const [file, every = '3', lift = 'squat'] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(file, 'utf8'));
const d = { w: raw.w, h: raw.h };
const side = nearSide(raw.frames);
console.log('near side', side, d);
raw.frames.forEach((f: Frame, i: number) => {
  if (i % +every) return;
  if (!f.p) return console.log((f.t / 1000).toFixed(2), 'no pose');
  const m = measure(f.p, d, side); const s = checkSpot(f.p, d);
  console.log((f.t / 1000).toFixed(2).padStart(6), 'knee', m.knee_deg.toFixed(0).padStart(4), 'hip', m.hip_deg.toFixed(0).padStart(4), 'depth', m.depth.toFixed(2).padStart(6), 'vis', m.minVis.toFixed(2), 'hipY', (m.hip.y / m.torso).toFixed(3), Object.entries(s.parts).map(([k, v]) => v ? k[0].toUpperCase() : k[0]).join(''), s.sideOn ? 'side' : 'FRONT', s.line ?? '');
});
const v = judgeClip(raw.frames, d, lift as Parameters<typeof judgeClip>[2]);
console.log(JSON.stringify({ fc: v.frameCheck, win: v.windowStart, call: v.result?.call, reps: v.result?.reps, low: v.result?.lowVisShare }, null, 0));
