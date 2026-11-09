// Plate traces from grey frames: item 70's plate tracker from each mark, frame by frame, with the stuck-track rule's
// whole-frame search (plan 3.4b). The grey frames come from the YouTube clips, so they are not committed: this file is
// how data/traces/*.json were made, for checking. The scoring runs from the committed traces (score.ts).
//
// Usage: npx tsx tests/bench-commands/track.ts <dir with grey/<id>.bin and grey/<id>.json> <marks.json> <out dir>
//
// Stuck: a match of STUCK.score or more with under 1 px of movement for STUCK.ms. While stuck, the tap's own template
// is searched over the whole frame each frame. If it matches somewhere else clearly better than at the stuck spot, the
// tracker starts again from there, with the tap's template. A trace point is [t ms, x, y, score, found]: x and y are
// fractions of the frame, `found` is 1 on a frame where the whole-frame search moved the tracker.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PlateTracker, TapTemplate, TRACK, reseed, type Gray } from './plate-tracker';
import { STUCK } from './caller';

export const TRACK_USED = { ...TRACK, tpl: 0.08, follow: 0.1, search: 0.08 };
/** The whole-frame search moves the tracker when the tap template matches at least this well ... */
export const FOUND_MIN = 0.6;
/** ... and this much better than at the stuck spot. */
export const FOUND_BETTER = 0.1;

type Mark = { t: number; x: number; y: number; racked: boolean };

export function trackClip(frames: (i: number) => Gray, times: number[], m: Mark) {
  let i0 = times.findIndex(t => t >= m.t * 1000 - 20); if (i0 < 0) i0 = 0;
  const f0 = frames(i0);
  const tr = new PlateTracker(f0, m.x, m.y, TRACK_USED);
  const tapT = new PlateTracker(f0, m.x, m.y, { ...TRACK_USED, follow: 0 });
  const tap = new TapTemplate(f0, m.x, m.y, TRACK_USED);
  const pts: number[][] = [];
  const px: { t: number; x: number; y: number; s: number }[] = [];
  for (let i = i0; i < times.length; i++) {
    const f = frames(i), t = times[i];
    let p = i === i0 ? { x: m.x, y: m.y, score: 1 } : tr.track(f);
    let found = 0;
    const X = p.x * f.w, Y = p.y * f.h;
    px.push({ t, x: X, y: Y, s: p.score }); while (px.length && px[0].t < t - STUCK.ms - 50) px.shift();
    const back = px.filter(q => q.t >= t - STUCK.ms);
    const stuck = p.score >= STUCK.score && back.length >= 3 && back[0].t <= t - STUCK.ms + 10 &&
      back.every(q => q.s >= STUCK.score && Math.abs(q.x - X) < 1 && Math.abs(q.y - Y) < 1);
    if (stuck) {
      const here = tap.at(f, X, Y), best = tap.searchAll(f);
      if (best.score >= FOUND_MIN && best.score > here + FOUND_BETTER && Math.hypot(best.x - X, best.y - Y) >= 1) {
        reseed(tr, tapT, best.x, best.y);
        p = { x: best.x / f.w, y: best.y / f.h, score: best.score }; found = 1;
        px.length = 0;
      }
    }
    pts.push([t, +p.x.toFixed(5), +p.y.toFixed(5), +p.score.toFixed(4), found]);
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
    console.log(id, pts.length, 'frames', pts.filter(q => q[4]).length ? `found ${pts.filter(q => q[4]).map(q => (q[0] / 1000).toFixed(2)).join(', ')}` : '');
  }
}
