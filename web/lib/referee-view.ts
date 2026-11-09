// What the referee's screens show (plan 5.33): the lift's name and the page title, the queue's
// wait, "What the judge measured", and the judge's marks for every frame of the clip, worked out
// on the server from the Workflow's pose points so the page never downloads the points.
import type { Db } from '@/db';
import type { Dims, Frame, Side } from '@/lib/judge';
import { measure } from '@/lib/judge';
import { closeCall, COMMAND_PROBLEM, WHY } from '@/lib/referee';

/** 3.7: lift names by division. */
const LIFT_NAMES: Record<string, { barbell: string; home: string }> = {
  squat: { barbell: 'Squat', home: 'Goblet squat' },
  bench: { barbell: 'Bench press', home: 'Overhead press' },
  deadlift: { barbell: 'Deadlift', home: 'Deadlift (dumbbells or bell)' },
};

export const liftName = (lift: string, division: string) =>
  LIFT_NAMES[lift]?.[division === 'home' ? 'home' : 'barbell'] ?? lift;

export const divisionName = (division: string) => (division === 'home' ? 'Home' : 'Barbell');

/** "100 lb", or a Home attempt's reps at a weight: "25 lb × 10". */
export function weightText(weight: number, units: string, repsDeclared: number | null) {
  const w = `${Number.isInteger(weight) ? weight : weight.toFixed(1)} ${units}`;
  return repsDeclared ? `${w} × ${repsDeclared}` : w;
}

/** One close call's page title: "<Lift> <n> · <weight> · <division>". */
export function closeCallTitle(a: { lift: string; number: number; weight: number; repsDeclared: number | null }, division: string, units: string) {
  return `${liftName(a.lift, division)} ${a.number} · ${weightText(a.weight, units, a.repsDeclared)} · ${divisionName(division)}`;
}

export const whyText = (reason: string | null) => (reason && WHY[reason]) || WHY.judge_unavailable;

/** Minutes waited, never "0 min". */
export const minutes = (s: number) => Math.max(1, Math.round(s / 60));

/** The queue's Body line: "<n> waiting · oldest <m> min". */
export function queueLine(rows: { waitingS: number }[]) {
  if (!rows.length) return null;
  return `${rows.length} waiting · oldest ${minutes(Math.max(...rows.map(r => r.waitingS)))} min`;
}

/**
 * "What the judge measured" (Small lines). On a `command_times` close call the judge didn't
 * run, so there's only the commands line.
 */
export function measuredLines(reason: string | null, m: Record<string, unknown> | null): string[] {
  const n = (k: string) => (typeof m?.[k] === 'number' && Number.isFinite(m[k]) ? (m[k] as number) : null);
  if (reason === 'command_times') {
    const problem = COMMAND_PROBLEM[String(m?.command_times ?? '')] ?? COMMAND_PROBLEM.missing_soft;
    return [`Commands: ${problem}. Judge this one by eye, from the clip.`];
  }
  const out: string[] = [];
  const depth = n('depth');
  if (depth !== null) out.push(`Depth: hip ${Math.abs(depth).toFixed(2)} thigh-lengths ${depth > 0 ? 'below' : 'above'} the knee`);
  const hip = n('lockout_hip_deg'), knee = n('lockout_knee_deg');
  if (hip !== null && knee !== null) out.push(`Lockout: hips ${Math.round(hip)}°, knees ${Math.round(knee)}°`);
  const pause = n('pause_s');
  if (pause !== null) out.push(`Pause: ${pause.toFixed(1)} s`);
  return out;
}

/** The marks on one frame, in the video's own pixels: shoulder, hip and knee on the judged side. */
export type MarkFrame = { t: number; s: [number, number]; h: [number, number]; k: [number, number] };
export type Track = { w: number; h: number; frames: MarkFrame[] };

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The judge's marks for every frame with a pose, from the stored pose points (poses/<attempt>.json). */
export function trackOf(poses: (Dims & { frames: Frame[] }) | null, side: Side | null): Track | null {
  if (!poses || !Array.isArray(poses.frames) || !(poses.w > 0) || !(poses.h > 0)) return null;
  const d = { w: poses.w, h: poses.h };
  const sideOf = side === 'right' ? 'right' : 'left';
  const frames: MarkFrame[] = [];
  for (const f of poses.frames) {
    if (!f.p) continue;
    const m = measure(f.p, d, sideOf);
    frames.push({ t: Math.round(f.t), s: [r1(m.sh.x), r1(m.sh.y)], h: [r1(m.hip.x), r1(m.hip.y)], k: [r1(m.knee.x), r1(m.knee.y)] });
  }
  frames.sort((a, b) => a.t - b.t);
  return frames.length ? { w: d.w, h: d.h, frames } : null;
}

/** What the page needs from R2: a signed link to the clip and the stored pose points. */
export interface ClipStore {
  signedGet(key: string, seconds?: number): Promise<string>;
  getJson<T>(key: string): Promise<T | null>;
}

/** One close call, ready for the page: never the lifter's name (5.33). */
export async function closeCallView(db: Db, store: ClipStore | null, attemptId: string) {
  const c = await closeCall(db, attemptId);
  if (!c) return null;
  const a = c.a;
  const m = (a.measures ?? null) as Record<string, unknown> | null;
  let videoUrl: string | null = null, track: Track | null = null;
  if (store && a.videoKey) {
    try { videoUrl = await store.signedGet(a.videoKey); } catch { videoUrl = null; }
  }
  if (store && a.posesKey && a.reason !== 'command_times') {
    try { track = trackOf(await store.getJson<Dims & { frames: Frame[] }>(a.posesKey), (m?.side as Side) ?? null); } catch { track = null; }
  }
  return {
    attempt: a, meetKind: c.meetKind, lifterId: c.lifterId, secondOpinion: c.secondOpinion,
    title: closeCallTitle(a, c.division, c.units),
    ageGroup: c.ageGroup,
    division: c.division,
    why: whyText(a.reason),
    measured: measuredLines(a.reason, m),
    videoUrl, track,
  };
}
