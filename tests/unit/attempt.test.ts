// A meet attempt judged on the server (plan 2.3 step 3, piece 8's command_times line).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCommandTimes, judgeAttempt, judgeClip, type Frame } from '@/lib/judge';

type Raw = { w: number; h: number; duration: number; frames: Frame[] };
const poses = (name: string): Raw => JSON.parse(readFileSync(join(__dirname, '../clips/poses', `${name}.json`), 'utf8'));

describe('command_times', () => {
  const ok = { loaded: 0, squat: 2000, rack: 6000 };
  it('accepts commands in order inside the clip', () => {
    expect(checkCommandTimes(ok, 'squat', 8000)).toBeNull();
    expect(checkCommandTimes({ loaded: 0, down: 5000 }, 'deadlift', 8000)).toBeNull();
    expect(checkCommandTimes({ ready: 0, squat: 1000, rep1: 3000, rep2: 6000, rack: 7000 }, 'squat', 8000)).toBeNull();
    // 3.8a writes them as "rep_3"
    expect(checkCommandTimes({ ready: 0, squat: 1000, rep_1: 3000, rep_2: 6000, rep_10: 6500, rack: 7000 }, 'squat', 8000)).toBeNull();
  });
  it.each([
    ['out of order', { loaded: 0, squat: 6000, rack: 2000 }, 'out_of_order'],
    ['outside the clip', { loaded: 0, squat: 2000, rack: 9000 }, 'outside_clip'],
    ['negative', { loaded: -5, squat: 2000, rack: 6000 }, 'outside_clip'],
    ['start before the soft command', { loaded: 3000, squat: 2000, rack: 6000 }, 'start_before_soft'],
    ['no soft command', { squat: 2000, rack: 6000 }, 'missing_soft'],
    ['no start command', { loaded: 0, rack: 6000 }, 'missing_start'],
    ['rep ends out of order', { ready: 0, squat: 1000, rep1: 6000, rep2: 3000, rack: 7000 }, 'out_of_order'],
    ['rep_ ends out of order', { ready: 0, squat: 1000, rep_2: 3000, rep_10: 2500, rack: 7000 }, 'out_of_order'],
    ['not a number', { loaded: 0, squat: '2000', rack: 6000 }, 'not_a_number'],
  ])('%s is a problem', (_, ct, want) => {
    expect(checkCommandTimes(ct as never, 'squat', 8000)).toBe(want);
  });
});

describe('judgeAttempt', () => {
  it('racked-squats-side, first rep between Squat! and Rack!: white', () => {
    const raw = poses('racked-squats-side');
    const v0 = judgeClip(raw.frames, raw, 'squat');
    const rep = v0.result!.reps[0];
    const v = judgeAttempt(raw.frames, raw, 'squat', { loaded: 0, squat: v0.windowStart!, rack: rep.endMs! + 600 });
    expect(v.call).toEqual({ light: 'white' });
    expect(v.lights).toEqual(['white', 'white', 'white']);
    expect(v.judgedFrameMs).toBe(rep.judgedFrameMs);
    expect(v.measures.depth).toBeGreaterThan(0.05);
  });
  it('half-squat: red depth', () => {
    const raw = poses('half-squat');
    const v0 = judgeClip(raw.frames, raw, 'squat', { skipFrameCheck: true });
    const rep = v0.result!.reps[0];
    const v = judgeAttempt(raw.frames, raw, 'squat', { loaded: 0, squat: v0.windowStart!, rack: rep.endMs! + 600 });
    expect(v.call).toEqual({ light: 'red', reason: 'depth' });
    expect(v.lights).toEqual(['red', 'red', 'red']);
  });
  it('deadlift-demo: white at lockout', () => {
    const raw = poses('deadlift-demo');
    const v = judgeAttempt(raw.frames, raw, 'deadlift', { loaded: 0, down: Math.floor(raw.duration * 1000) - 50 });
    expect(v.call.light).toBe('white');
    expect(v.measures.lockout_hip_deg).toBeGreaterThan(165);
  });
  it('bad command times on a good squat: a close call, never a white', () => {
    const raw = poses('racked-squats-side');
    for (const ct of [{ loaded: 0, squat: 9000, rack: 1000 }, { loaded: 0, squat: 1000, rack: 999999 }, { loaded: 5000, squat: 1000, rack: 9000 }, null]) {
      const v = judgeAttempt(raw.frames, raw, 'squat', ct);
      expect(v.call).toEqual({ light: 'close', reason: 'command_times' });
      expect(v.lights).toBeNull();
    }
  });

});

describe('a Home attempt: every declared rep judged (3.8a)', () => {
  const raw = poses('racked-squats-side');
  const v0 = judgeClip(raw.frames, raw, 'squat');
  const reps = v0.result!.reps;
  const ct = { ready: 0, squat: v0.windowStart!, rack: reps.at(-1)!.endMs! + 600 };
  it('5 white reps declared 5: a good lift, each rep\'s light saved, the last rep\'s frame', () => {
    expect(reps).toHaveLength(5);
    const v = judgeAttempt(raw.frames, raw, 'squat', ct, undefined, 5);
    expect(v.call).toEqual({ light: 'white' });
    expect(v.repLights).toHaveLength(5);
    expect(v.repLights!.every(r => r.call === 'white')).toBe(true);
    expect(v.judgedFrameMs).toBe(reps[4].judgedFrameMs);
  });
  it('declared 6, only 5 seen: a close call for a referee, never a white', () => {
    const v = judgeAttempt(raw.frames, raw, 'squat', ct, undefined, 6);
    expect(v.call).toEqual({ light: 'close', reason: 'visibility' });
    expect(v.measures).toMatchObject({ reps_declared: 6, reps_seen: 5 });
  });
  it('a red rep makes the attempt red, naming the rep', () => {
    const half = poses('half-squat');
    const h0 = judgeClip(half.frames, half, 'squat', { skipFrameCheck: true });
    const hct = { ready: 0, squat: h0.windowStart!, rack: h0.result!.reps.at(-1)!.endMs! + 600 };
    const v = judgeAttempt(half.frames, half, 'squat', hct, undefined, 2);
    expect(v.call).toEqual({ light: 'red', reason: 'depth' });
    expect(v.measures.red_rep).toBe(1);
    expect(v.judgedFrameMs).toBe(h0.result!.reps[0].judgedFrameMs);
  });
});
