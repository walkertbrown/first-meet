// Each bench's Pause line, as the referee bot is sent it (plan 3.4d step 11, "Each Pause line against the eye", item
// 110; 3.4b, "The smoothing is in time, not points"). test_pause.py runs this and checks every line against the eye.
//
// Every bench attempt of the set (build-set.ts's benchAttempts, measured on the phone's own path as takeBar does),
// in each run:
// - the camera: the 30 fps trace as recorded, or a 15 or 20 fps camera made from it by dropping frames (every other
//   one for 15; 2 of every 3 kept for 20), each frame at its own time;
// - the tick: each camera frame once (the grid), at the live 16.7 ms tick, or fed 3 times (liveFeed);
// - the plant: none, or one bad frame in each real pause, at the camera frame nearest the middle of the eye's pause,
//   0.05 of the frame lower or higher.
// The cuts and their commands are the same in every run: only the phone's path changes.
//
// Usage: TSX_TSCONFIG_PATH=web/tsconfig.json npx tsx tests/referee-bot/pauses.ts [out.json]   (JSON on stdout)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BarPoint } from '../../web/lib/judge/bar-measure';
import { measuredLines } from '../../web/lib/referee-view';
import { liveFeed, type Live } from '../bench-commands/score';
import { benchAttempts, type Trace } from './build-set';

const BENCH = join(__dirname, '../bench-commands/data');
const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8'));

export const CAMERAS = [30, 20, 15] as const;
export const TICKS = ['grid', 'tick', 'three'] as const;
export const PLANTS = [0, 0.05, -0.05] as const;
type Camera = (typeof CAMERAS)[number];
type Tick = (typeof TICKS)[number];

/** Each clip's real pauses by eye, [stop, end] in s of the clip: the meet attempts' and every gym rep's. */
export function eyePauses(): Record<string, [number, number][]> {
  const out: Record<string, [number, number][]> = {};
  const add = (id: string, reps: [number, number, string][]) => {
    for (const [stop, end] of reps) if (end > stop) (out[id] ??= []).push([stop, end]);
  };
  for (const m of json<{ attempts: { id: string; reps: [number, number, string][] }[] }>(join(BENCH, 'calls-meet.json')).attempts) add(m.id, m.reps.slice(0, 1));
  for (const g of json<{ attempts: { id: string; reps: [number, number, string][] }[] }>(join(BENCH, 'calls-run1.json')).attempts) add(g.id, g.reps);
  return out;
}

/** The 30 fps trace as a slower camera: frames dropped, each kept one at its own time. */
export function camera(pts: BarPoint[], fps: Camera): BarPoint[] {
  if (fps === 30) return pts;
  return pts.filter((_, i) => (fps === 15 ? i % 2 === 0 : i % 3 !== 2));
}

/** One bad frame in each pause: the camera frame nearest its middle, `dy` of the frame lower (+) or higher (-). */
export function plant(pts: BarPoint[], pauses: [number, number][], dy: number): BarPoint[] {
  if (!dy || !pts.length) return pts;
  const out = pts.map(p => [...p] as BarPoint);
  for (const [stop, end] of pauses) {
    const mid = ((stop + end) / 2) * 1000;
    let k = 0;
    for (let i = 1; i < out.length; i++) if (Math.abs(out[i][0] - mid) < Math.abs(out[k][0] - mid)) k = i;
    out[k][2] = Math.min(1, Math.max(0, out[k][2] + dy));
  }
  return out;
}

/** The camera's frames as the phone's caller saw them. */
export function fed(pts: BarPoint[], fps: Camera, tick: Tick): BarPoint[] {
  if (tick === 'grid' || !pts.length) return pts;
  return liveFeed(pts, 1000 / fps, tick as Live) as BarPoint[];
}

export type PauseRow = { id: string; eye_pause_s: number | null; line: string | null; sent_s: number | null; pause_s: number | null };
export type PauseRun = { camera: Camera; tick: Tick; plant: number; rows: PauseRow[] };

/** Each bench's Pause line in one run. A bench with no measures (the camera-cut demo) or no Pause line has `line: null`. */
export function pauseRun(fps: Camera, tick: Tick, dy: number, pauses = eyePauses()): PauseRun {
  const change = (id: string, tr: Trace): Trace => ({ ...tr, pts: fed(plant(camera(tr.pts, fps), pauses[id] ?? [], dy), fps, tick) });
  const { attempts } = benchAttempts({ trace: change });
  const rows = attempts.map(a => {
    const lines = a.measures ? measuredLines(a.reason, a.measures, { commandTimes: a.command_times }) : [];
    const line = lines.find(l => l.startsWith('Pause')) ?? null;
    const m = line?.match(/still (\d+(?:\.\d+)?) s/);
    const p = a.measures?.pause_s;
    return { id: a.id, eye_pause_s: a.eye_pause_s ?? null, line, sent_s: m ? Number(m[1]) : null, pause_s: typeof p === 'number' ? p : null };
  });
  return { camera: fps, tick, plant: dy, rows };
}

export function allRuns(): PauseRun[] {
  const pauses = eyePauses();
  return CAMERAS.flatMap(c => TICKS.flatMap(t => PLANTS.map(d => pauseRun(c, t, d, pauses))));
}

if (process.argv[1]?.endsWith('pauses.ts')) {
  const out = JSON.stringify({ runs: allRuns() }, null, 1) + '\n';
  if (process.argv[2]) writeFileSync(process.argv[2], out);
  else process.stdout.write(out);
}
