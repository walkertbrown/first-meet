// The expected calls (expected.json) and the one check, shared by the unit test on
// saved poses and judge.spec.ts on poses found fresh in Chromium.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSpot, judgeClip, type Call, type Frame, type SpotCheck } from '../../web/lib/judge';

export const CLIPS_DIR = __dirname;

export type Expect = {
  lift: 'squat' | 'deadlift';
  frameCheck?: 'pass' | 'fail';
  line?: string;
  /** Seconds [from, to] the line is read on, when not the whole clip. */
  lineFrom?: [number, number];
  lineNote?: string;
  /** The calls with the frame check as written. */
  reps?: string[];
  /** The calls with the frame check skipped. */
  skipped?: string[];
  /** Frame-check parts that fail on most of the clip. */
  failing?: SpotCheck[];
};

export const EXPECTED = Object.entries(JSON.parse(readFileSync(join(CLIPS_DIR, 'expected.json'), 'utf8')) as Record<string, Expect | string>)
  .filter((e): e is [string, Expect] => typeof e[1] !== 'string');

export const callName = (c: Call) => (c.light === 'white' ? 'white' : `${c.light}:${c.reason}`);

/** The line shown most often between two seconds of the clip. */
export function lineBetween(raw: { w: number; h: number; frames: Frame[] }, [from, to]: [number, number]) {
  const n = new Map<string | null, number>();
  for (const f of raw.frames) {
    if (f.t < from * 1000 || f.t > to * 1000) continue;
    const line = checkSpot(f.p, raw).line ?? null;
    n.set(line, (n.get(line) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** What the judge gives on one clip, in the shape expected.json uses. */
export function verdictOf(raw: { w: number; h: number; frames: Frame[] }, e: Expect) {
  const d = { w: raw.w, h: raw.h };
  const v = judgeClip(raw.frames, d, e.lift);
  const s = e.skipped ? judgeClip(raw.frames, d, e.lift, { skipFrameCheck: true }) : null;
  return {
    frameCheck: v.frameCheck.passed ? 'pass' : 'fail',
    line: e.lineFrom ? lineBetween(raw, e.lineFrom) : v.frameCheck.commonLine,
    failShare: v.frameCheck.failShare,
    reps: v.result?.reps.map(r => callName(r.call)) ?? [],
    skipped: s?.result?.reps.map(r => callName(r.call)) ?? [],
  };
}

type Ex = (actual: unknown, message?: string) => { toBe(v: unknown): void; toEqual(v: unknown): void; toBeGreaterThan(n: number): void };

/** Checks one clip against its expected calls, with vitest's or Playwright's expect. */
export function checkClip(expect: Ex, raw: { w: number; h: number; frames: Frame[] }, e: Expect) {
  const v = verdictOf(raw, e);
  if (e.frameCheck) expect(v.frameCheck, 'frame check').toBe(e.frameCheck);
  if (e.line) expect(v.line, 'line shown').toBe(e.line);
  for (const part of e.failing ?? []) expect(v.failShare[part], `${part} fails on most frames`).toBeGreaterThan(0.5);
  if (e.reps) expect(v.reps, 'calls').toEqual(e.reps);
  if (e.skipped) expect(v.skipped, 'calls with the frame check skipped').toEqual(e.skipped);
}
