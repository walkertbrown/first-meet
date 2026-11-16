// The server's plate tracker (worker/plate.py) against the phone's (web/lib/judge/plate-tracker.ts)
// on the same grey frames (plan 3.4b: "The server's tracker uses the same rules"). Run by CI's
// worker job: WORKER_PYTHON=python npx vitest run -c tests/worker/vitest.config.ts
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BAR_FRAME_H, BAR_TRACK, PlateTracker, type Gray } from '../../web/lib/judge';

const PY = process.env.WORKER_PYTHON;
const CLI = join(__dirname, '../../worker/plate_cli.py');
type Point = [number, number, number, number];
type Grey = { w: number; h: number; times: number[]; buf: Uint8Array };

const frameOf = (g: Grey, i: number): Gray => ({ w: g.w, h: g.h, px: g.buf.subarray(i * g.w * g.h, (i + 1) * g.w * g.h) });

/** The phone's tracker on the frames, in plate.py's track_frames shape. */
function trackJs(g: Grey, x: number, y: number, size: number): Point[] {
  const out: Point[] = [[g.times[0], x, y, 1]];
  const tr = new PlateTracker(frameOf(g, 0), x, y, { ...BAR_TRACK, tpl: size });
  for (let i = 1; i < g.times.length; i++) {
    const r = tr.track(frameOf(g, i));
    out.push([g.times[i], r.x, r.y, r.score]);
  }
  return out;
}

function save(g: Grey): string {
  const dir = mkdtempSync(join(tmpdir(), 'plate-'));
  writeFileSync(join(dir, 'grey.bin'), g.buf);
  writeFileSync(join(dir, 'grey.json'), JSON.stringify({ w: g.w, h: g.h, times: g.times }));
  return dir;
}

const trackPy = (dir: string, x: number, y: number, size: number): Point[] =>
  JSON.parse(execFileSync(PY!, [CLI, 'track', dir, String(x), String(y), String(size)], { encoding: 'utf8', maxBuffer: 64 << 20 }));

function agree(g: Grey, js: Point[], py: Point[]) {
  expect(py).toHaveLength(js.length);
  let dPx = 0, dScore = 0;
  for (let i = 0; i < js.length; i++) {
    expect(py[i][0]).toBe(js[i][0]);
    dPx = Math.max(dPx, Math.abs(py[i][1] - js[i][1]) * g.w, Math.abs(py[i][2] - js[i][2]) * g.h);
    dScore = Math.max(dScore, Math.abs(py[i][3] - js[i][3]));
  }
  // plate.py rounds x and y to 5 places and the score to 4
  expect(dPx, 'the two paths are within 0.01 px of the 160 px frame').toBeLessThan(0.01);
  expect(dScore).toBeLessThan(2e-4);
  return { frames: js.length, maxPx: +dPx.toFixed(5), maxScore: +dScore.toFixed(5) };
}

/** A plate (a ringed disc) that drops, waits and rises over a noisy, textured floor. */
function synthetic(): Grey {
  const w = 284, h = BAR_FRAME_H, n = 90;
  const buf = new Uint8Array(w * h * n);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const floor = new Uint8Array(w * h).map((_, k) => 60 + ((k % w) * 7 + Math.floor(k / w) * 13) % 50);
  for (let f = 0; f < n; f++) {
    const s = f / n;
    const cx = 140 + 6 * Math.sin(s * 3), cy = 50 + 40 * (s < 0.4 ? s / 0.4 : s < 0.6 ? 1 : (1 - s) / 0.4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const v = d < 7 ? 220 - 15 * Math.floor(d) : floor[y * w + x];
      buf[f * w * h + y * w + x] = Math.max(0, Math.min(255, Math.round(v + (rnd() - 0.5) * 12)));
    }
  }
  return { w, h, times: Array.from({ length: n }, (_, i) => Math.round(i * 1000 / 15)), buf };
}

/** The most textured template-sized square on the first frame: a fair stand-in for a tap. */
function busiest(g: Grey, n: number): [number, number] {
  const f = frameOf(g, 0); let best = -1, bx = 0, by = 0;
  for (let y = n; y < g.h - n; y += 2) for (let x = n; x < g.w - n; x += 2) {
    let s = 0, s2 = 0;
    for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) { const p = f.px[(y + j) * g.w + x + i]; s += p; s2 += p * p; }
    const v = s2 - s * s / 169;
    if (v > best) { best = v; bx = x; by = y; }
  }
  return [bx / g.w, by / g.h];
}

describe.skipIf(!PY)('the server follows the plate the way the phone does', () => {
  it('a synthetic plate, dropping and rising', () => {
    const g = synthetic();
    const tap: [number, number] = [140 / g.w, 50 / g.h];
    const py = trackPy(save(g), ...tap, BAR_TRACK.tpl);
    const r = agree(g, trackJs(g, ...tap, BAR_TRACK.tpl), py);
    // and it follows the plate: 40 px lower at the bottom (frames 36-54), back up at the end
    expect(Math.abs(py[45][2] * g.h - 90)).toBeLessThan(1);
    expect(Math.abs(py[89][2] * g.h - 50.4)).toBeLessThan(1.5);
    console.log('synthetic', JSON.stringify(r));
  });

  it("a real clip's 15 fps grey frames, made by plate.py", () => {
    const dir = mkdtempSync(join(tmpdir(), 'plate-clip-'));
    execFileSync(PY!, [CLI, 'grey', join(__dirname, '../clips/deadlift-demo.webm'), dir]);
    const meta = JSON.parse(readFileSync(join(dir, 'grey.json'), 'utf8'));
    expect(meta.h).toBe(BAR_FRAME_H);
    const g: Grey = { ...meta, buf: new Uint8Array(readFileSync(join(dir, 'grey.bin'))) };
    const tap = busiest(g, 13);
    const r = agree(g, trackJs(g, ...tap, BAR_TRACK.tpl), trackPy(dir, ...tap, BAR_TRACK.tpl));
    console.log('deadlift-demo', JSON.stringify({ tap, ...r }));
    // and the worker's own call (worker/main.py one_bar: plate.track_clip) gives the same path
    const clip: Point[] = JSON.parse(execFileSync(PY!, [CLI, 'clip', join(__dirname, '../clips/deadlift-demo.webm'), String(tap[0]), String(tap[1]), String(BAR_TRACK.tpl)], { encoding: 'utf8', maxBuffer: 64 << 20 }));
    expect(clip).toEqual(trackPy(dir, ...tap, BAR_TRACK.tpl));
  });
});
