// The press judges on synthetic poses: the Barbell bench (3.4) and Home's overhead press (3.7).
import { describe, expect, it } from 'vitest';
import { BenchCaller, judgePress, pressKey, pressTimes, type PressCommand } from '@/lib/judge/press';
import { OverheadCaller, judgeOverhead, type OverheadCommand } from '@/lib/judge/overhead';
import { judgeAttempt } from '@/lib/judge/attempt';
import type { Frame } from '@/lib/judge/pose';
import { BENT_TOP, d, DOWN, hold, LOCKED, move, RACKED, UP, arm } from './press-poses';

function runBench(frames: Frame[]) {
  const c = new BenchCaller(d);
  const ct: Record<string, number> = { loaded: 0 };
  const cmds: PressCommand[] = [];
  for (const f of frames) {
    let x = c.feed(f);
    while (x) {
      cmds.push(x);
      ct[x.cmd === 'press' ? pressKey(x.k, x.late) : x.cmd === 'rep' ? `rep_${x.k}` : x.cmd] = x.t;
      x = x.cmd === 'rep' ? c.feed(f) : null;
    }
  }
  return { ct, cmds };
}

describe('bench (Barbell)', () => {
  const still = (t0: number, ms: number, a: [number, number]) => hold(t0, ms, t => arm(a[0], a[1], { jitter: 2, t }));
  const paused = [
    ...still(0, 1000, UP), ...move(1000, 1000, UP, DOWN), ...still(2000, 900, DOWN),
    ...move(2900, 800, DOWN, UP), ...still(3700, 1000, UP),
  ];

  it('calls Start!, Press! on the still bottom, then Rack! after the lockout', () => {
    const { cmds } = runBench(paused);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'press', 'rep', 'rack']);
  });

  it('gives a white to a paused rep pressed on the call', () => {
    const { ct } = runBench(paused);
    const r = judgePress(paused, d, { start: ct.start, end: ct.rack }, pressTimes(ct));
    expect(r.call).toEqual({ light: 'white' });
  });

  it('gives red no_pause when the bar went down and up with no "Press!"', () => {
    const tng = [...still(0, 1000, UP), ...move(1000, 700, UP, DOWN), ...move(1700, 700, DOWN, UP), ...still(2400, 1000, UP)];
    const { ct } = runBench(tng);
    expect(ct.press).toBeUndefined();
    const r = judgePress(tng, d, { start: ct.start, end: ct.rack ?? 3400 }, pressTimes(ct));
    expect(r.call).toEqual({ light: 'red', reason: 'no_pause' });
  });

  it('gives red no_lockout when the elbows never straighten after "Press!"', () => {
    const half: [number, number] = [-40, -90]; // elbow ~130°
    const frames = [...still(0, 1000, UP), ...move(1000, 1000, UP, DOWN), ...still(2000, 900, DOWN), ...move(2900, 600, DOWN, half), ...still(3500, 2000, half)];
    const { ct } = runBench(frames);
    expect(ct.press).toBeDefined();
    const r = judgePress(frames, d, { start: ct.start, end: 5500 }, pressTimes(ct));
    expect(r.call).toEqual({ light: 'red', reason: 'no_lockout' });
  });

  it('a Barbell bench attempt is judged, not sent to a referee', () => {
    const { ct } = runBench(paused);
    const v = judgeAttempt(paused, { ...d, duration: 4.7 }, 'bench', ct);
    expect(v.call).toEqual({ light: 'white' });
    expect(v.measures.press_ms).toBe(ct.press);
  });

  // The pose missed the bent elbow: the arm reads straight, angled 35° up, the wrist 0.42 arm below Start!.
  const MISSED: [number, number] = [-35, -35];
  const missedBottom = [
    ...still(0, 1000, UP), ...move(1000, 800, UP, MISSED), ...still(1800, 2500, MISSED),
    ...move(4300, 800, MISSED, UP), ...still(5100, 1000, UP),
  ];

  it('calls a late "Press!" within 2 s when the bar is down and still but the bent elbow was missed', () => {
    const { ct, cmds } = runBench(missedBottom);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'press', 'rep', 'rack']);
    expect(ct.press).toBeUndefined();
    expect(ct.press_late).toBeGreaterThan(1800);
    expect(ct.press_late - 1800).toBeLessThanOrEqual(2000);
    // she's never racked with the bar on her chest: the rep ends only once the wrists are back up
    expect(ct.rep_1).toBeGreaterThan(4300);
  });

  it('a late "Press!" is always a close call for a referee, never a light', () => {
    const { ct } = runBench(missedBottom);
    const r = judgePress(missedBottom, d, { start: ct.start, end: ct.rack }, pressTimes(ct));
    expect(r.call).toEqual({ light: 'close', reason: 'visibility' });
    const v = judgeAttempt(missedBottom, { ...d, duration: 6.1 }, 'bench', ct);
    expect(v.call).toEqual({ light: 'close', reason: 'visibility' });
    expect(v.lights).toBeNull();
  });

  it('no late "Press!" for a small dip (under 0.3 arm) or while the bar is still moving', () => {
    const DIP: [number, number] = [-55, -55]; // wrist 0.18 arm below Start!
    expect(runBench([...still(0, 1000, UP), ...move(1000, 600, UP, DIP), ...still(1600, 2500, DIP)]).ct.press_late).toBeUndefined();
    const drifting = [...still(0, 1000, UP), ...move(1000, 800, UP, MISSED), ...move(1800, 2500, MISSED, [-20, -20])];
    expect(runBench(drifting).ct.press_late).toBeUndefined();
  });

  it('a missed bottom is a close call, never a red: pressed with no "Press!" and the elbows never seen under 110°', () => {
    const tngMissed = [...still(0, 1000, UP), ...move(1000, 700, UP, MISSED), ...move(1700, 700, MISSED, UP), ...still(2400, 1000, UP)];
    const { ct } = runBench(tngMissed);
    expect(ct.press).toBeUndefined();
    expect(ct.press_late).toBeUndefined();
    const r = judgePress(tngMissed, d, { start: ct.start, end: 3400 }, pressTimes(ct));
    expect(r.call).toEqual({ light: 'close', reason: 'visibility' });
  });

  it('a rise before "Press!" is red no_pause only when the server saw the elbows bend under 110°', () => {
    // down, still, then rising: "Press!" comes 400 ms into the rise (the phone's times, given by hand)
    const rep = (bottom: [number, number]) => [
      ...still(0, 1000, UP), ...move(1000, 800, UP, bottom), ...still(1800, 900, bottom),
      ...move(2700, 800, bottom, UP), ...still(3500, 1000, UP),
    ];
    const ct = { loaded: 0, start: 933, press: 3100, rep_1: 3900, rack: 3900 };
    const seen = judgePress(rep(DOWN), d, { start: ct.start, end: ct.rack }, pressTimes(ct));
    expect(seen.call).toEqual({ light: 'red', reason: 'no_pause' });
    const unseen = judgePress(rep(MISSED), d, { start: ct.start, end: ct.rack }, pressTimes(ct));
    expect(unseen.reps[0].riseArm).toBeGreaterThan(0.03);
    expect(unseen.call).toEqual({ light: 'close', reason: 'visibility' });
  });

  it('reads press_late keys as late presses', () => {
    const t = pressTimes({ start: 1, press_late: 5, rep_1: 7, press_late_2: 9, press_3: 11 });
    expect(t.presses).toEqual({ 1: 5, 2: 9, 3: 11 });
    expect([...t.late!]).toEqual([1, 2]);
    expect(pressKey(1, true)).toBe('press_late');
    expect(pressKey(2, true)).toBe('press_late_2');
    expect(pressKey(2)).toBe('press_2');
  });
});

function runOverhead(frames: Frame[], reps: number) {
  const c = new OverheadCaller(d, undefined, { reps });
  const ct: Record<string, number> = { ready: 0 };
  const cmds: OverheadCommand[] = [];
  for (const f of frames) {
    let x = c.feed(f);
    while (x) {
      cmds.push(x);
      ct[x.cmd === 'rep' ? `rep_${x.k}` : x.cmd] = x.t;
      x = x.cmd === 'rep' ? c.feed(f) : null;
    }
  }
  return { ct, cmds };
}

describe('overhead press (Home)', () => {
  const still = (t0: number, ms: number, a: [number, number]) => hold(t0, ms, t => arm(a[0], a[1], { jitter: 2, t }));
  const rep = (t0: number, top: [number, number] = LOCKED, holdMs = 800) => [
    ...move(t0, 700, RACKED, top), ...still(t0 + 700, holdMs, top), ...move(t0 + 700 + holdMs, 700, top, RACKED), ...still(t0 + 1400 + holdMs, 300, RACKED),
  ];

  it('calls Start! at the shoulders, a rep at each held lockout, then Rack!', () => {
    const frames = [...still(0, 1000, RACKED), ...rep(1000), ...rep(3200)];
    const { cmds } = runOverhead(frames, 2);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'rep', 'rep', 'rack']);
  });

  it('never calls "Press!"', () => {
    const frames = [...still(0, 1000, RACKED), ...rep(1000)];
    expect(runOverhead(frames, 1).cmds.some(c => (c.cmd as string) === 'press')).toBe(false);
  });

  it('gives a white to every locked, held rep', () => {
    const frames = [...still(0, 1000, RACKED), ...rep(1000), ...rep(3200)];
    const { ct } = runOverhead(frames, 2);
    const r = judgeOverhead(frames, d, { start: ct.start, end: ct.rack }, pressTimes(ct).repEnds, 2);
    expect(r.reps.map(x => x.call.light)).toEqual(['white', 'white']);
    expect(r.call).toEqual({ light: 'white' });
  });

  it('gives red no_lockout to a rep that stops short of a lockout, and Home\'s 8 s rule racks the set', () => {
    const frames = [...still(0, 1000, RACKED), ...rep(1000), ...rep(3200, BENT_TOP, 1000), ...still(6100, 9000, RACKED)];
    const { ct, cmds } = runOverhead(frames, 2);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'rep', 'rack']);
    const r = judgeOverhead(frames, d, { start: ct.start, end: ct.rack }, pressTimes(ct).repEnds, 2);
    expect(r.reps.map(x => x.call)).toEqual([{ light: 'white' }, { light: 'red', reason: 'no_lockout' }]);
    expect(r.call).toEqual({ light: 'red', reason: 'no_lockout' });
  });

  it('gives a close call borderline_lockout to a rep held between 155° and 165°', () => {
    const NEAR: [number, number] = [-80, -100]; // elbows ~160°, wrists above the nose
    const frames = [...still(0, 1000, RACKED), ...rep(1000, NEAR, 1000), ...still(3700, 18000, RACKED)];
    const { ct, cmds } = runOverhead(frames, 1);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'rack']);
    const r = judgeOverhead(frames, d, { start: ct.start, end: ct.rack }, pressTimes(ct).repEnds, 1);
    expect(r.reps[0].call).toEqual({ light: 'close', reason: 'borderline_lockout' });
    expect(r.reps[0].lockoutElbowDeg).toBeGreaterThan(155);
    expect(r.reps[0].lockoutElbowDeg).toBeLessThanOrEqual(165);
  });

  it('counts a lockout whose dumbbells settle a little (under 12% of the arm in 0.4 s), not one that keeps moving', () => {
    // the wrists sink `px` pixels over the 800 ms hold at the top (the arm is 240 px)
    const settle = (px: number) => (t0: number) => hold(t0, 800, t => {
      const p = arm(LOCKED[0], LOCKED[1]);
      const dy = (px * (t - t0)) / 800 / d.h;
      p[15] = [p[15][0], p[15][1] + dy, p[15][2]]; p[16] = [p[16][0], p[16][1] + dy, p[16][2]];
      return p;
    });
    const set = (px: number) => [
      ...still(0, 1000, RACKED), ...move(1000, 700, RACKED, LOCKED), ...settle(px)(1700),
      ...move(2500, 700, LOCKED, RACKED), ...still(3200, 300, RACKED),
    ];
    const ok = set(40); // 20 px in 0.4 s: 8% of the arm
    const { ct, cmds } = runOverhead(ok, 1);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'rep', 'rack']);
    expect(judgeOverhead(ok, d, { start: ct.start, end: ct.rack }, pressTimes(ct).repEnds, 1).call).toEqual({ light: 'white' });
    expect(runOverhead(set(120), 1).cmds.map(c => c.cmd)).toEqual(['start']); // 60 px in 0.4 s: 25%
  });

  it('waits for "Start!" while the elbows are over 100° or the wrists are above the nose', () => {
    const HIGH: [number, number] = [-20, -100]; // wrists above the nose
    const OPEN: [number, number] = [70, 20]; // elbows ~130°, wrists below the nose
    expect(runOverhead([...still(0, 2000, HIGH)], 1).cmds).toEqual([]);
    expect(runOverhead([...still(0, 2000, OPEN)], 1).cmds).toEqual([]);
  });

  it('a failed rep before a good one is the red: the first time the wrists go above the nose', () => {
    const frames = [...still(0, 1000, RACKED), ...rep(1000, BENT_TOP, 600), ...rep(3000)];
    const { ct, cmds } = runOverhead(frames, 1);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'rep', 'rack']);
    const r = judgeOverhead(frames, d, { start: ct.start, end: ct.rack }, pressTimes(ct).repEnds, 1);
    expect(r.reps[0].call).toEqual({ light: 'red', reason: 'no_lockout' });
  });

  it('a Home bench attempt is the overhead press, judged per declared rep', () => {
    const frames = [...still(0, 1000, RACKED), ...rep(1000), ...rep(3200)];
    const { ct } = runOverhead(frames, 2);
    const v = judgeAttempt(frames, { ...d, duration: 6 }, 'bench', ct, undefined, 2);
    expect(v.call).toEqual({ light: 'white' });
    expect(v.repLights?.map(x => x.call)).toEqual(['white', 'white']);
  });
});
