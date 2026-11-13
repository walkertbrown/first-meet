// The referee's words and marks (5.33) and the red-light reasons a referee can pick (3.5).
import { describe, expect, it } from 'vitest';
import { barTrackOf, BENCH_LINES, closeCallTitle, liftName, measuredLines, minutes, queueLine, trackOf, weightText, whyText } from '@/lib/referee-view';
import { BAR_RULES, type BarPoint } from '@/lib/judge';
import { reasonEyebrow, reasonSentence, refereeReasons } from '@/lib/reason-words';
import type { Pt } from '@/lib/judge/pose';

describe('referee words', () => {
  it('lift names by division (3.7)', () => {
    expect(liftName('squat', 'barbell')).toBe('Squat');
    expect(liftName('squat', 'home')).toBe('Goblet squat');
    expect(liftName('bench', 'home')).toBe('Overhead press');
  });
  it('the page title: lift, attempt, weight, division; Home shows the reps', () => {
    expect(closeCallTitle({ lift: 'squat', number: 2, weight: 100, repsDeclared: null }, 'barbell', 'lb')).toBe('Squat 2 · 100 lb · Barbell');
    expect(closeCallTitle({ lift: 'bench', number: 1, weight: 12.5, repsDeclared: 10 }, 'home', 'kg')).toBe('Overhead press 1 · 12.5 kg × 10 · Home');
    expect(weightText(102.25, 'lb', null)).toBe('102.3 lb');
  });
  it('why it was sent, falling back to "the judge couldn\'t run"', () => {
    expect(whyText('borderline_depth')).toBe('Depth right on the line');
    expect(whyText(null)).toBe("The judge couldn't run");
    expect(whyText('nonsense')).toBe("The judge couldn't run");
  });
  it('the queue line, never "0 min"', () => {
    expect(queueLine([])).toBeNull();
    expect(queueLine([{ waitingS: 20 }, { waitingS: 400 }])).toBe('2 waiting · oldest 7 min');
    expect(minutes(5)).toBe(1);
  });
  it('what the judge measured', () => {
    expect(measuredLines('borderline_depth', { depth: -0.034, lockout_hip_deg: 171.6, lockout_knee_deg: 176.2 })).toEqual([
      'Depth: hip 0.03 thigh-lengths above the knee',
      'Lockout: hips 172°, knees 176°',
    ]);
    expect(measuredLines('borderline_depth', { depth: 0.05 })).toEqual(['Depth: hip 0.05 thigh-lengths below the knee']);
    expect(measuredLines('short_pause', { pause_s: 0.42 })).toEqual(['Pause: 0.4 s']);
    expect(measuredLines('judge_unavailable', null)).toEqual([]);
  });
  it('a command_times close call says only the commands line', () => {
    expect(measuredLines('command_times', { command_times: 'missing_start', depth: 0.2 })).toEqual([
      "Commands: the start command is missing. Judge this one by eye, from the clip.",
    ]);
  });
});

describe('the judge\'s marks', () => {
  const pose = (hipY: number): Pt[] => {
    const p: Pt[] = Array.from({ length: 33 }, () => [0.5, 0.5, 1] as Pt);
    p[11] = [0.4, 0.2, 1]; p[23] = [0.45, hipY, 1]; p[25] = [0.6, 0.6, 1]; p[27] = [0.6, 0.9, 1];
    p[12] = [0.9, 0.1, 1]; p[24] = [0.95, 0.15, 1]; p[26] = [0.99, 0.2, 1];
    return p;
  };
  it('shoulder, hip and knee in pixels for every frame with a pose, in time order', () => {
    const t = trackOf({ w: 1000, h: 500, frames: [{ t: 66.6, p: pose(0.62) }, { t: 0, p: pose(0.5) }, { t: 33, p: null }] }, 'left');
    expect(t).toEqual({
      w: 1000, h: 500,
      frames: [
        { t: 0, s: [400, 100], h: [450, 250], k: [600, 300] },
        { t: 67, s: [400, 100], h: [450, 310], k: [600, 300] },
      ],
    });
  });
  it('the right side when the judge used it; nothing without poses', () => {
    const t = trackOf({ w: 100, h: 100, frames: [{ t: 0, p: pose(0.5) }] }, 'right');
    expect(t!.frames[0].h).toEqual([95, 15]);
    expect(trackOf(null, 'left')).toBeNull();
    expect(trackOf({ w: 0, h: 100, frames: [{ t: 0, p: pose(0.5) }] }, 'left')).toBeNull();
    expect(trackOf({ w: 100, h: 100, frames: [{ t: 0, p: null }] }, 'left')).toBeNull();
  });
});

describe('a Barbell bench (3.4b, 5.33, look 5.13)', () => {
  const ct = { start: 1000, press: 2400, rack: 3800, plate_tap: { x: 0.5, y: 0.3, size: 0.08 } };
  it('the bar\'s pause and the line on every bench; never the pose lines', () => {
    expect(measuredLines('bench_referee', { pause_s: 0.62, depth: 0.1, press_while_sinking: false }, { commandTimes: ct })).toEqual([
      'Pause: the bar was still 0.6 s before Press!',
      "If she pressed on the phone's Press! before the bar had stopped, that's the phone's mistake: don't give a red for the pause.",
    ]);
  });
  it('Press! while sinking, and a late Press! (still or lost), each say so', () => {
    expect(measuredLines('bench_referee', { pause_s: 0, press_while_sinking: true }, { commandTimes: ct })).toContain(BENCH_LINES.sinking);
    expect(BENCH_LINES.sinking).toBe("The phone called Press! while the bar was still going down. That's the phone's mistake: don't give a red for the pause.");
    const still = measuredLines('bench_referee', {}, { commandTimes: { start: 1000, press_late: 3000, press_late_why: 'still', rack: 4000 } });
    expect(still).toEqual([BENCH_LINES.every, 'The phone called Press! late, after 1.5 s still.']);
    const lost = measuredLines('bench_referee', {}, { commandTimes: { start: 1000, press_late: 3000, press_late_why: 'lost', rack: 4000 } });
    expect(lost).toEqual([BENCH_LINES.every, 'The phone lost the bar and called Press! late. Judge the pause by eye, from the clip.']);
  });
  it('a command_times bench is still only the commands line', () => {
    expect(measuredLines('command_times', { command_times: 'missing_start' }, { commandTimes: {} })).toEqual(['Commands: the start command is missing. Judge this one by eye, from the clip.']);
  });

  // a bench in a 1000 x 1000 frame, 100 ms a point: on the hooks at 0.30, down to 0.50, a pause, back up;
  // a 2 px wobble so the stuck-track rule never fires, and the tracker lost it from 3000 to 3200 ms
  const ok = BAR_RULES.lostScore + 0.05, lostScore = Math.max(0, BAR_RULES.lostScore - 0.2);
  const yAt = (t: number) => (t <= 1000 ? 0.3 : t <= 2000 ? 0.3 + 0.2 * (t - 1000) / 1000 : t <= 2600 ? 0.5 : t <= 3600 ? 0.5 - 0.2 * (t - 2600) / 1000 : 0.3);
  const path: BarPoint[] = [];
  for (let t = 0; t <= 4500; t += 100) path.push([t, 0.5, +(yAt(t) + (t / 100 % 2 ? 0.002 : 0)).toFixed(4), t >= 3000 && t <= 3200 ? lostScore : ok]);
  const bar = { w: 1000, h: 1000, path };

  it('the plate\'s path in pixels breaks where the bar was lost; a tick for each command on the path', () => {
    const b = barTrackOf(bar, ct, { press_while_sinking: false })!;
    expect(b.w).toBe(1000);
    expect(b.segs).toHaveLength(2);
    expect(b.segs[0].at(-1)).toEqual([500, yAt(2900) * 1000 + 2]);
    expect(b.segs[1][0]).toEqual([500, yAt(3300) * 1000 + 2]);
    expect(b.ticks.map(t => [t.label, t.x, Math.round(t.y), t.wide])).toEqual([['START!', 500, 300, false], ['PRESS!', 500, 500, false], ['RACK!', 500, 300, false]]);
  });
  it('Press! while sinking makes the Press! tick wide; a late Press! in the lost stretch sits on the last point seen', () => {
    expect(barTrackOf(bar, ct, { press_while_sinking: true })!.ticks.find(t => t.cmd === 'press')!.wide).toBe(true);
    const late = barTrackOf(bar, { start: 1000, press_late: 3100, press_late_why: 'lost', rack: 3800 }, null)!;
    const p = late.ticks.find(t => t.cmd === 'press')!;
    expect([p.label, p.y]).toEqual(['PRESS!', yAt(2900) * 1000 + 2]);
  });
  it('nothing to draw without a path or commands', () => {
    expect(barTrackOf(null, ct, null)).toBeNull();
    expect(barTrackOf(bar, null, null)).toBeNull();
    expect(barTrackOf({ w: 0, h: 1000, path }, ct, null)).toBeNull();
  });
});

describe('the reasons a referee can give', () => {
  it('depth on the squat, the pause on the press, a hitch on the deadlift', () => {
    expect(refereeReasons('squat')).toContain('depth');
    expect(refereeReasons('squat')).not.toContain('no_pause');
    expect(refereeReasons('bench')).toContain('no_pause');
    expect(refereeReasons('bench')).not.toContain('depth');
    expect(refereeReasons('deadlift')).toContain('downward');
    for (const lift of ['squat', 'bench', 'deadlift']) expect(refereeReasons(lift)).toHaveLength(5);
    // Home's press is the overhead press (5.34): no "Press!", so no pause to miss
    expect(refereeReasons('bench', 'home')).toEqual(['no_lockout', 'moved_feet', 'weight_not_shown', 'not_whole_lift']);
  });
  it('the sentence fits the lift and division', () => {
    expect(reasonSentence('no_lockout', 'bench', 'barbell')).toMatch(/elbows lock/);
    expect(reasonSentence('no_lockout', 'squat', 'barbell')).toMatch(/stand all the way up/);
    expect(reasonSentence('no_lockout', 'bench', 'home')).toBe("Your arms didn't straighten enough overhead, or didn't stay still at the top. Next time, press until your elbows are straight and hold it for a moment.");
    expect(reasonSentence('no_pause', 'bench', 'barbell')).toMatch(/rest on your chest/);
  });
  it('a Home red names the rep', () => {
    expect(reasonEyebrow('depth', 6)).toBe('REP 6 · DEPTH');
    expect(reasonEyebrow('downward', null)).toBe('HITCH');
  });
});
