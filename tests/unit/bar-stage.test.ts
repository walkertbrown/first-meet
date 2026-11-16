// The phone's bench stage (plan 3.4b, look 5.14c) on drawn frames: a plate on a textured room, moving the way
// a bench moves. The tap, the mark following it, lost on the hooks, a second tap, the commands, the void and
// `plate_tap`.
import { describe, expect, it } from 'vitest';
import { BarStage } from '../../web/lib/judge/bar-stage';
import { BENCH, DIMS, DT, H, RACK, W, cmds, frame, run, type Seg } from './bar-frames';

describe('the bench stage (3.4b)', () => {
  it('takes her tap as plate_tap, follows the plate, and calls Start!, Press! and Rack!', () => {
    const st = new BarStage(DIMS);
    expect(st.state).toBe('tap');
    expect(st.feed(frame(...RACK, 0), 0)).toEqual([]);
    expect(st.tap(frame(...RACK, 0), RACK[0] + 0.004, RACK[1] - 0.004)).toBe(true);
    expect(st.plateTap).toEqual({ x: 0.624, y: 0.296, size: 0.08 });
    const { evs } = run(st, RACK, BENCH);
    expect(cmds(evs)).toEqual(['start', 'press', 'rack']);
    // the mark follows the plate on the hooks, and goes at "Start!"
    const start = evs.findIndex(e => e.type === 'cmd');
    const marks = evs.slice(0, start).filter(e => e.type === 'mark');
    expect(marks.length).toBeGreaterThan(60);
    const m0 = marks[5] as { x: number; y: number };
    expect(Math.abs(m0.x - RACK[0]) * W).toBeLessThan(2.5);
    expect(Math.abs(m0.y - RACK[1]) * H).toBeLessThan(2.5);
    expect(evs.slice(start).some(e => e.type === 'mark')).toBe(false);
    // the path is every frame, none lost
    expect(st.path.length).toBeGreaterThan(200);
    expect(st.path.every(p => !p.lost)).toBe(true);
    expect(st.state).toBe('done');
    expect(st.voided).toBe(false);
    // no tap once the lift has started
    expect(st.tap(frame(...RACK, 0), 0.5, 0.5)).toBe(false);
  });

  it('is lost on the hooks after 1 s under the line: the mark goes, and a new tap starts again', () => {
    const st = new BarStage(DIMS);
    st.tap(frame(...RACK, 0), ...RACK);
    const a = run(st, RACK, [{ ms: 500 }, { ms: 1500, plate: false }]);
    const lost = a.evs.filter(e => e.type === 'lost');
    expect(lost).toHaveLength(1);
    // 1 s after the plate went (500 ms in), within a frame or two
    expect(lost[0].t).toBeGreaterThanOrEqual(1500);
    expect(lost[0].t).toBeLessThanOrEqual(1500 + 3 * DT);
    expect(st.state).toBe('tap');
    expect(st.plateTap).toBeNull();
    // nothing more until she taps again
    expect(st.feed(frame(...RACK, 99), a.t + DT)).toEqual([]);
    expect(st.tap(frame(...RACK, 100), ...RACK)).toBe(true);
    const b = run(st, RACK, BENCH, a.t + DT);
    expect(cmds(b.evs)).toEqual(['start', 'press', 'rack']);
  });

  it('moves the mark on a second tap before Start!', () => {
    const st = new BarStage(DIMS);
    st.tap(frame(...RACK, 0), 0.3, 0.7); // the wrong place: a patch of wall
    run(st, RACK, [{ ms: 300 }]);
    expect(st.tap(frame(...RACK, 10), ...RACK)).toBe(true);
    expect(st.plateTap).toEqual({ x: RACK[0], y: RACK[1], size: 0.08 });
    const { evs } = run(st, RACK, BENCH, 300);
    const m = evs.find(e => e.type === 'mark') as { x: number; y: number };
    expect(Math.abs(m.x - RACK[0]) * W).toBeLessThan(2.5);
    expect(cmds(evs)).toEqual(['start', 'press', 'rack']);
  });

  it('calls a void Rack! with no Start! within 5 s of leaving the hooks', () => {
    const st = new BarStage(DIMS);
    st.tap(frame(...RACK, 0), ...RACK);
    // out of the rack, then never still: it wanders
    const wander: Seg[] = [{ ms: 1000 }, { ms: 600, to: [0.55, 0.22] }];
    for (let i = 0; i < 12; i++) wander.push({ ms: 500, to: i % 2 ? [0.55, 0.22] : [0.5, 0.27] });
    const { evs } = run(st, RACK, wander);
    expect(cmds(evs)).toEqual(['rack(void)']);
    expect(st.voided).toBe(true);
    expect(st.state).toBe('done');
  });

  it('breaks the path where the plate was lost after Start!, and calls the late Press!', () => {
    const st = new BarStage(DIMS);
    st.tap(frame(...RACK, 0), ...RACK);
    const { evs } = run(st, RACK, [...BENCH.slice(0, 3), { ms: 500, to: [0.55, 0.3] }, { ms: 2600, plate: false }, { ms: 3200, plate: false }]);
    expect(cmds(evs)).toEqual(['start', 'press(late)', 'rack']);
    const press = evs.find(e => e.type === 'cmd' && e.cmd === 'press') as { why?: string };
    expect(press.why).toBe('lost');
    expect(st.path.some(p => p.lost)).toBe(true);
  });
});
