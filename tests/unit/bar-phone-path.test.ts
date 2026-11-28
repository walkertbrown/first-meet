// Items 110 and 114 on the server (3.4b, "The lights"; 3.4d step 1; 5.33; look 5.14c): the phone's own bar_path and
// how it was fed. The check (checkPhonePath), bar_cadence as sent (cadenceOf), the guard's stretch length on "frame",
// the frames' path where the phone's is lost (framesPath), and the referee's lines and scrub-bar ticks with no phone path.
import { describe, expect, it } from 'vitest';
import { BAR_RULES, stuckStretches, type BarPoint } from '../../web/lib/judge';
import { cadenceOf, checkPhonePath, MAX_SENT_POINTS } from '../../web/lib/judge/bar-measure';
import { framesPath } from '../../web/lib/referee/bot';
import { barTrackOf, BENCH_LINES, measuredLines, scrubTicks } from '../../web/lib/referee-view';
import { placeLabels } from '../../web/components/referee-call';

const TAP = { x: 0.5, y: 0.3, size: 0.08 };
const CT = { loaded: 0, start: 2000, press: 4300, rack: 6200, plate_tap: TAP } as unknown as Record<string, number>;

describe('checkPhonePath: bar_path checked as command_times are (item 110)', () => {
  const ok = [[0, 0.5, 0.3, 0.9, 0], [33, 0.5, 0.31, 0.2, 1], [34, 0.5, 0.32, 0.95, 0], [6000, 1, 0, 0.5, 0]];
  it('takes [t, x, y, score, lost] inside the clip, strictly increasing, x and y on the frame; a lost point gets score 0', () => {
    expect(checkPhonePath(ok, 6000)).toEqual({ path: [[0, 0.5, 0.3, 0.9], [33, 0.5, 0.31, 0], [34, 0.5, 0.32, 0.95], [6000, 1, 0, 0.5]] });
  });
  it('has no limit on how close the points are (1 ms apart is fine)', () => {
    const dense = Array.from({ length: 3000 }, (_, i) => [i, 0.5, 0.5, 0.9, 0]);
    expect('path' in checkPhonePath(dense, 3000)).toBe(true);
  });
  it.each([
    ['missing', undefined],
    ['missing', null],
    ['shape', 'points'],
    ['empty', []],
    ['too_long', Array.from({ length: MAX_SENT_POINTS + 1 }, (_, i) => [i, 0.5, 0.5, 0.9, 0])],
    ['shape', [[0, 0.5, 0.5, 0.9]]],
    ['shape', [[0, 0.5, 0.5, 0.9, 2]]],
    ['shape', [[0, 0.5, 0.5, 1.5, 0]]],
    ['shape', [[0, 0.5, '0.5', 0.9, 0]]],
    ['shape', [[0, 0.5, Number.NaN, 0.9, 0]]],
    ['outside_clip', [[-1, 0.5, 0.5, 0.9, 0]]],
    ['outside_clip', [[0, 0.5, 0.5, 0.9, 0], [6001, 0.5, 0.5, 0.9, 0]]],
    ['not_increasing', [[10, 0.5, 0.5, 0.9, 0], [10, 0.5, 0.5, 0.9, 0]]],
    ['not_increasing', [[10, 0.5, 0.5, 0.9, 0], [9, 0.5, 0.5, 0.9, 0]]],
    ['off_frame', [[0, -0.01, 0.5, 0.9, 0]]],
    ['off_frame', [[0, 0.5, 1.01, 0.9, 0]]],
  ] as [string, unknown][])('%s: %j is no usable phone path', (problem, raw) => {
    expect(checkPhonePath(raw, 6000)).toEqual({ problem });
  });
});

describe('bar_cadence as sent (item 114)', () => {
  it('"frame" and "refresh" as they are; missing reads as "refresh"', () => {
    expect(cadenceOf('frame')).toEqual({ cadence: 'frame' });
    expect(cadenceOf('refresh')).toEqual({ cadence: 'refresh' });
    expect(cadenceOf(undefined)).toEqual({ cadence: 'refresh' });
    expect(cadenceOf(null)).toEqual({ cadence: 'refresh' });
  });
  it('anything else reads as "refresh", and comes back printable and short for the bar_cadence_unknown row', () => {
    expect(cadenceOf('Frame')).toEqual({ cadence: 'refresh', unknown: 'Frame' });
    expect(cadenceOf(30)).toEqual({ cadence: 'refresh', unknown: '30' });
    expect(cadenceOf({ a: 1 })).toEqual({ cadence: 'refresh', unknown: '{"a":1}' });
    expect(cadenceOf('x'.repeat(100)).unknown).toHaveLength(40);
    expect(cadenceOf('a\u0000b\nc').unknown).toBe('abc');
  });
});

describe('the stuck guard on "frame" (item 114, "Skipped frames")', () => {
  // A 30 fps camera, moving; frozen dead still from 3.0 to 4.0 s with the tracker slowed to every other frame there.
  const cam: BarPoint[] = [];
  for (let k = 0; k * 33.3 <= 6000; k++) {
    const t = Math.round(k * 33.3), still = t >= 3000 && t <= 4000;
    if (still && k % 2) continue;
    cam.push([t, still ? 0.5 : 0.3 + k * 0.004, still ? 0.42 : 0.3 + k * 0.004, 0.6]);
  }
  const still = cam.filter(p => p[0] >= 3000 && p[0] <= 4000);
  it('a stretch is its last time less its first plus the median gap, so skipped frames don\'t shorten it', () => {
    expect(still.length).toBeLessThan(BAR_RULES.stuckMs / 33.3);
    const s = stuckStretches(cam, CT, BAR_RULES, 'frame');
    expect(s).toHaveLength(1);
    expect(s[0][0]).toBeGreaterThanOrEqual(3000);
    expect(s[0][1]).toBeLessThanOrEqual(4000);
  });
  it('a moving bar on "frame" is never stuck', () => {
    const moving = cam.map(([t]) => [t, 0.3 + t * 0.00004, 0.3 + t * 0.00004, 0.9]) as BarPoint[];
    expect(stuckStretches(moving, CT, BAR_RULES, 'frame')).toEqual([]);
  });
});

describe("framesPath: the server's track stands in where the phone's is lost, for the frames only (3.4d step 1)", () => {
  const phone: BarPoint[] = [[0, 0.5, 0.3, 0.9], [100, 0.5, 0.31, 0.9], [200, 0.5, 0.32, 0.1], [900, 0.5, 0.4, 0.9], [1000, 0.5, 0.41, 0.9]];
  const server: BarPoint[] = [[67, 0.6, 0.3, 0.8], [400, 0.6, 0.35, 0.8], [600, 0.6, 0.38, 0], [1067, 0.6, 0.42, 0.8], [1200, 0.6, 0.43, 0.8]];
  it('fills a stretch of 500 ms or more with no phone point that counts, and after the last; keeps every phone point that counts', () => {
    expect(framesPath(phone, server)).toEqual([
      [0, 0.5, 0.3, 0.9], [100, 0.5, 0.31, 0.9],
      [400, 0.6, 0.35, 0.8], [600, 0.6, 0.38, 0],
      [900, 0.5, 0.4, 0.9], [1000, 0.5, 0.41, 0.9],
      [1067, 0.6, 0.42, 0.8], [1200, 0.6, 0.43, 0.8],
    ]);
  });
  it('a shorter gap is left to the phone', () => {
    // 0 to 400 ms is under 500 ms, so the server's 67 isn't taken; 400 to 1200 is a hole, so its 600 and 1067 are
    const tight: BarPoint[] = [[0, 0.5, 0.3, 0.9], [400, 0.5, 0.3, 0.9], [1200, 0.5, 0.3, 0.9]];
    expect(framesPath(tight, server).map(p => p[0])).toEqual([0, 400, 600, 1067, 1200]);
  });
  it('with no server track the phone path is as it was; a phone path with nothing that counts takes the server\'s', () => {
    expect(framesPath(phone, null)).toBe(phone);
    expect(framesPath(phone.map(([t, x, y]) => [t, x, y, 0.1]) as BarPoint[], server).filter(p => p[3] >= 0.5).map(p => p[0])).toEqual([67, 400, 1067, 1200]);
  });
});

describe("the referee's page with no usable phone path (5.33, look 5.14c)", () => {
  const none = { bar_path: 'none', pause_lost: false, press_while_sinking: true };
  it('says why, reads "Pause: not measured. No bar path from the phone.", and has no "Press! while sinking" line', () => {
    const lines = measuredLines('bench_referee', none, { commandTimes: CT });
    expect(lines).toContain(BENCH_LINES.noPath);
    expect(lines).toContain('Pause: not measured. No bar path from the phone.');
    expect(BENCH_LINES.noPath).toBe("We didn't get the phone's bar path, so the pause wasn't measured. Judge the pause by eye, from the clip.");
    expect(lines).not.toContain(BENCH_LINES.sinking);
    expect(lines).not.toContain(BENCH_LINES.pauseLost);
    expect(lines).not.toContain(BENCH_LINES.lostNear);
    expect(lines.some(l => /^Pause: the bar was still/.test(l))).toBe(false);
    // the other lines as their own rules say
    expect(lines).toContain(BENCH_LINES.every);
    expect(measuredLines('bench_referee', none, { commandTimes: { ...CT, rack_why: 'lost' } })).toContain(BENCH_LINES.rackLost);
  });
  it('with the phone path, the lines are as before', () => {
    const lines = measuredLines('bench_referee', { bar_path: 'phone', pause_s: 1.2 }, { commandTimes: CT });
    expect(lines).toContain('Pause: the bar was still 1.2 s before Press!');
    expect(lines).not.toContain(BENCH_LINES.noPath);
  });
  it("draws no path from the server's track: the three commands go on the scrub bar, a press_late Press! at its time", () => {
    const bar = { w: 640, h: 360, source: 'server' as const, path: [[0, 0.5, 0.3, 0.9], [3000, 0.5, 0.4, 0.9]] as BarPoint[] };
    expect(barTrackOf(bar, CT, null)).toEqual({ w: 640, h: 360, segs: [], ticks: [], scrub: [
      { cmd: 'start', label: 'START!', ms: 2000 }, { cmd: 'press', label: 'PRESS!', ms: 4300 }, { cmd: 'rack', label: 'RACK!', ms: 6200 },
    ] });
    // an older file with no source, but measures that say no phone path, the same
    expect(barTrackOf({ ...bar, source: undefined }, CT, { bar_path: 'none' })?.segs).toEqual([]);
    const late = { loaded: 0, start: 2000, press_late: 5100, rack: 7000 };
    expect(scrubTicks(late).map(t => [t.label, t.ms])).toEqual([['START!', 2000], ['PRESS!', 5100], ['RACK!', 7000]]);
  });
  it("the phone's path is still drawn as before", () => {
    const bar = { w: 640, h: 360, source: 'phone' as const, path: Array.from({ length: 100 }, (_, i) => [i * 70, 0.5, 0.3 + (i % 5) * 0.01, 0.9]) as BarPoint[] };
    const t = barTrackOf(bar, CT, { bar_path: 'phone' });
    expect(t?.scrub).toBeUndefined();
    expect(t?.segs.length).toBeGreaterThan(0);
  });
});

describe("the scrub bar's labels (look 5.14c)", () => {
  it('centred on their ticks', () => expect(placeLabels(800, [100, 400, 700], [50, 50, 40])).toEqual([75, 375, 680]));
  it('never past the bar\'s ends: at an end, aligned to it', () => expect(placeLabels(800, [5, 795], [50, 40])).toEqual([0, 760]));
  it('at least 8 px apart: the later one moves right, its tick where it is', () => {
    expect(placeLabels(800, [100, 120, 130], [50, 50, 40])).toEqual([75, 133, 191]);
  });
});
