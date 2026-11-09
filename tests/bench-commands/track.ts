// Plate traces from grey frames: item 70's plate tracker from each mark, frame by frame. The grey frames come from the
// YouTube clips, so they are not committed: this file is how data/traces/*.json were made, for checking. The scoring runs
// from the committed traces (score.ts).
//
// Usage: npx tsx tests/bench-commands/track.ts <dir with grey/<id>.bin and grey/<id>.json> <marks.json> <out dir>
//
// No whole-frame search (plan 3.4b, choice (b)): a lost or stuck track is only found again by the tracker's own search
// around its last spot. The stuck rule itself is the caller's (caller.ts). A trace point is [t ms, x, y, score], with x
// and y fractions of the frame.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BAR_TRACK, PlateTracker, type Gray } from './plate-tracker';

// the bench's settings (shared/rules.json benchBar.tracker): the template 8% of the frame tall
export const TRACK_USED = BAR_TRACK;

type Mark = { t: number; x: number; y: number; racked: boolean };

export function trackClip(frames: (i: number) => Gray, times: number[], m: Mark) {
  let i0 = times.findIndex(t => t >= m.t * 1000 - 20); if (i0 < 0) i0 = 0;
  const f0 = frames(i0);
  const tr = new PlateTracker(f0, m.x, m.y, TRACK_USED);
  const pts: number[][] = [];
  for (let i = i0; i < times.length; i++) {
    const p = i === i0 ? { x: m.x, y: m.y, score: 1 } : tr.track(frames(i));
    pts.push([times[i], p.x, p.y, p.score]);
  }
  return pts;
}

if (process.argv[1]?.endsWith('track.ts')) {
  const [dir, marksFile, out] = process.argv.slice(2);
  const marks: Record<string, Mark> = JSON.parse(readFileSync(marksFile, 'utf8'));
  for (const [id, m] of Object.entries(marks)) {
    if (id.startsWith('_')) continue;
    const meta = JSON.parse(readFileSync(join(dir, 'grey', `${id}.json`), 'utf8'));
    const buf = readFileSync(join(dir, 'grey', `${id}.bin`)); const size = meta.w * meta.h;
    const frame = (i: number): Gray => ({ w: meta.w, h: meta.h, px: new Uint8Array(buf.buffer, buf.byteOffset + i * size, size) });
    const pts = trackClip(frame, meta.t, m);
    writeFileSync(join(out, `${id}.json`), JSON.stringify({ id, w: meta.w, h: meta.h, racked: m.racked, mark: m, pts }));
    console.log(id, pts.length, 'frames');
  }
}
