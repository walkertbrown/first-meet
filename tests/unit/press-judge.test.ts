// The press judges on synthetic poses: the Barbell bench (3.4) and Home's overhead press (3.7).
import { describe, expect, it } from 'vitest';
import { BenchCaller, judgePress, pressKey, pressTimes, type PressCommand } from '@/lib/judge/press';
import { OverheadCaller, judgeOverhead, type OverheadCommand } from '@/lib/judge/overhead';
import { judgeAttempt } from '@/lib/judge/attempt';
import type { Frame } from '@/lib/judge/pose';
import { d, DOWN, hold, move, UP, arm, front, moveFront, F_BENT, F_LOCKED, F_NEAR, F_RACKED } from './press-poses';

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

describe('overhead press (Home), filmed front-on (3.4c, A)', () => {
  const still = (t0: number, ms: number, a: [number, number], vis?: Record<number, number>) =>
    hold(t0, ms, t => front(a[0], a[1], { jitter: 2, t, vis }));
  /** A rep: up over 700 ms, `holdMs` at the top, down over 700 ms, then 300 ms at the shoulders (2.5 s with the default hold). */
  const rep = (t0: number, top: [number, number] = F_LOCKED, holdMs = 800) => [
    ...moveFront(t0, 700, F_RACKED, top), ...still(t0 + 700, holdMs, top), ...moveFront(t0 + 700 + holdMs, 700, top, F_RACKED), ...still(t0 + 1400 + holdMs, 300, F_RACKED),
  ];
  const judge = (frames: Frame[], ct: Record<string, number>) => judgeOverhead(frames, d, { start: ct.start, end: ct.rack });

  it('calls Start! at the shoulders after 0.3 s still, counts each rep as it comes down, then Rack!', () => {
    const frames = [...still(0, 1000, F_RACKED), ...rep(1000), ...rep(3500)];
    const { cmds } = runOverhead(frames, 2);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'rep', 'rep', 'rack']);
    expect(cmds[0].t).toBeLessThan(400);
    // each rep is counted on the way down, not at the top
    expect(cmds[1].t).toBeGreaterThan(1000 + 700 + 800);
  });

  it('never calls "Press!"', () => {
    const frames = [...still(0, 1000, F_RACKED), ...rep(1000)];
    expect(runOverhead(frames, 1).cmds.some(c => (c.cmd as string) === 'press')).toBe(false);
  });

  it('gives a white to every rep held 0.4 s at 145° or more', () => {
    const frames = [...still(0, 1000, F_RACKED), ...rep(1000), ...rep(3500)];
    const { ct } = runOverhead(frames, 2);
    const r = judge(frames, ct);
    expect(r.reps.map(x => x.call.light)).toEqual(['white', 'white']);
    expect(r.reps[0].lockoutElbowDeg).toBeGreaterThanOrEqual(145);
    expect(r.call).toEqual({ light: 'white' });
  });

  it('counts a bent rep like any other, gives it red no_lockout, and judges every rep after it', () => {
    const frames = [...still(0, 1000, F_RACKED), ...rep(1000), ...rep(3500, F_BENT), ...rep(6000)];
    const { ct, cmds } = runOverhead(frames, 3);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'rep', 'rep', 'rep', 'rack']);
    const r = judge(frames, ct);
    expect(r.reps.map(x => x.call)).toEqual([{ light: 'white' }, { light: 'red', reason: 'no_lockout' }, { light: 'white' }]);
    expect(r.reps[1].lockoutElbowDeg).toBeLessThan(135);
    expect(r.call).toEqual({ light: 'red', reason: 'no_lockout' });
  });

  it('gives a close call borderline_lockout to a rep held at 135–145°', () => {
    const frames = [...still(0, 1000, F_RACKED), ...rep(1000, F_NEAR, 1000)];
    const { ct } = runOverhead(frames, 1);
    const r = judge(frames, ct);
    expect(r.reps[0].call).toEqual({ light: 'close', reason: 'borderline_lockout' });
    expect(r.reps[0].lockoutElbowDeg).toBeGreaterThanOrEqual(135);
    expect(r.reps[0].lockoutElbowDeg).toBeLessThan(145);
  });

  it('gives red no_lockout to a straight-armed rep that never holds still at the top', () => {
    const frames = [...still(0, 1000, F_RACKED), ...moveFront(1000, 700, F_RACKED, F_LOCKED), ...moveFront(1700, 700, F_LOCKED, F_RACKED), ...still(2400, 300, F_RACKED)];
    const { ct, cmds } = runOverhead(frames, 1);
    expect(cmds.map(c => c.cmd)).toEqual(['start', 'rep', 'rack']);
    const r = judge(frames, ct);
    expect(r.reps[0].call).toEqual({ light: 'red', reason: 'no_lockout' });
    expect(r.reps[0].held).toBe(false);
  });

  it('a hold is dumbbells settling under 12% of her arm in 0.4 s, not ones that keep moving', () => {
    // the wrists sink `px` pixels over the 800 ms at the top (the arm is 240 px)
    const settle = (px: number) => (t0: number) => hold(t0, 800, t => {
      const p = front(F_LOCKED[0], F_LOCKED[1]);
      const dy = (px * (t - t0)) / 800 / d.h;
      p[15] = [p[15][0], p[15][1] + dy, p[15][2]]; p[16] = [p[16][0], p[16][1] + dy, p[16][2]];
      return p;
    });
    const set = (px: number) => [
      ...still(0, 1000, F_RACKED), ...moveFront(1000, 700, F_RACKED, F_LOCKED), ...settle(px)(1700),
      ...moveFront(2500, 700, F_LOCKED, F_RACKED), ...still(3200, 300, F_RACKED),
    ];
    const ok = set(40); // 20 px in 0.4 s: 8% of the arm
    const a = runOverhead(ok, 1);
    expect(judge(ok, a.ct).call).toEqual({ light: 'white' });
    const moving = set(120); // 60 px in 0.4 s: 25%
    const b = runOverhead(moving, 1);
    expect(b.cmds.map(c => c.cmd)).toEqual(['start', 'rep', 'rack']);
    expect(judge(moving, b.ct).call).toEqual({ light: 'red', reason: 'no_lockout' });
  });

  it('a hold needs both wrists above the nose', () => {
    // elbows straight out to the sides at shoulder height: 180°, but the wrists are below the nose
    const OUT: [number, number] = [180, 180];
    const frames = [...still(0, 1000, F_RACKED), ...moveFront(1000, 700, F_RACKED, F_LOCKED), ...moveFront(1700, 300, F_LOCKED, OUT), ...still(2000, 800, OUT), ...moveFront(2800, 500, OUT, F_RACKED), ...still(3300, 300, F_RACKED)];
    const { ct } = runOverhead(frames, 1);
    expect(judge(frames, ct).reps[0].call).toEqual({ light: 'red', reason: 'no_lockout' });
  });

  it('waits for "Start!" while an elbow is at 100° or more, or a wrist is more than 0.2 arm above the nose', () => {
    const OPEN: [number, number] = [135, -165]; // elbows 120°, wrists low
    const HIGH: [number, number] = [-170, -60]; // elbows 70°, wrists 55 px (0.23 arm) above the nose
    expect(runOverhead([...still(0, 2000, OPEN)], 1).cmds).toEqual([]);
    expect(runOverhead([...still(0, 2000, HIGH)], 1).cmds).toEqual([]);
    // a wrist up to 0.2 arm above the nose still counts as racked
    const JUST: [number, number] = [170, -75]; // elbows 65°, wrists 25 px (0.1 arm) above the nose
    expect(runOverhead([...still(0, 2000, JUST)], 1).cmds.map(c => c.cmd)).toEqual(['start']);
  });

  it('"Rack!" 8 s after a rep with no new one, and 20 s after "Start!" with no rep at all', () => {
    const one = [...still(0, 1000, F_RACKED), ...rep(1000), ...still(3500, 9000, F_RACKED)];
    const a = runOverhead(one, 3);
    expect(a.cmds.map(c => c.cmd)).toEqual(['start', 'rep', 'rack']);
    expect(a.ct.rack - a.ct.rep_1).toBeGreaterThanOrEqual(8000);
    const none = runOverhead([...still(0, 21000, F_RACKED)], 3);
    expect(none.cmds.map(c => c.cmd)).toEqual(['start', 'rack']);
    expect(none.cmds[1]).toMatchObject({ noRep: true });
  });

  it('a close call for visibility when the nose or an arm point isn\'t seen on the judged frame', () => {
    const up = [...still(0, 1000, F_RACKED), ...moveFront(1000, 700, F_RACKED, F_LOCKED), ...still(1700, 800, F_LOCKED), ...moveFront(2500, 700, F_LOCKED, F_RACKED), ...still(3200, 300, F_RACKED)];
    // the left wrist goes dark while the arms are up
    const frames = up.map(f => (f.t > 1300 && f.t < 2700 ? { ...f, p: f.p!.map((q, i) => (i === 15 ? [q[0], q[1], 0.3] : q)) as Frame['p'] } : f));
    const { ct } = runOverhead(frames, 1);
    expect(judge(frames, ct).reps[0].call).toEqual({ light: 'close', reason: 'visibility' });
  });

  it('a Home bench attempt is the overhead press: every rep judged, the set\'s light from 3.8a', () => {
    const frames = [...still(0, 1000, F_RACKED), ...rep(1000), ...rep(3500)];
    const { ct } = runOverhead(frames, 2);
    const v = judgeAttempt(frames, { ...d, duration: 7 }, 'bench', ct, undefined, 2);
    expect(v.call).toEqual({ light: 'white' });
    expect(v.repLights?.map(x => x.call)).toEqual(['white', 'white']);
    const bent = [...still(0, 1000, F_RACKED), ...rep(1000), ...rep(3500, F_NEAR, 1000)];
    const b = runOverhead(bent, 2);
    expect(judgeAttempt(bent, { ...d, duration: 7 }, 'bench', b.ct, undefined, 2).call).toEqual({ light: 'close', reason: 'borderline_lockout' });
  });
});
