// Item 114 (3.2, "One point per camera frame", "The fallback is chosen by what happens", "Skipped frames"): the
// attempt page's frame-or-tick feed (BarFeed), run on the real bench stage with drawn camera frames at 30 fps and a
// 60 Hz refresh tick. NerdCider's three fallback tests, the skipped-frame test, and what the page sends (sentPath).
import { describe, expect, it } from 'vitest';
import { MeetLift, type MeetEvent } from '../../web/lib/judge/meet-lift';
import { sentPath } from '../../web/lib/judge/bar-stage';
import { BarFeed, CadencePick, frameTimeOf, NO_CALLBACK_MS, type FrameMeta } from '../../web/lib/stage/bar-cadence';
import { BENCH, DIMS, DT, RACK, frame, type Seg } from './bar-frames';

const TICK = 1000 / 60;
/** performance.now() when the attempt starts: never 0, as on a real page */
const T0 = 50_000;

/** Where the plate is at `t` ms on a path of segments from `start` (bar-frames.ts `run`'s path, by time). */
function posAt(start: [number, number], segs: Seg[], t: number): [number, number] {
  let [x, y] = start, at = 0;
  for (const s of segs) {
    const [x1, y1] = s.to ?? [x, y];
    if (t <= at + s.ms) { const u = (t - at) / s.ms; return [x + (x1 - x) * u, y + (y1 - y) * u]; }
    [x, y] = [x1, y1]; at += s.ms;
  }
  return [x, y];
}
const lengthOf = (segs: Seg[]) => segs.reduce((n, s) => n + s.ms, 0);

type Sim = {
  /** the camera frames' callback fires for frame k at camera time t (ms from the attempt's start) */
  callback?: (k: number, t: number) => boolean;
  /** the camera sends no new picture at t (a stall: currentTime stops too) */
  stalled?: (t: number) => boolean;
  /** from this time the camera sends the same picture again and again (a frozen picture) */
  freezeAt?: number;
  segs?: Seg[];
  until?: number;
};

/**
 * One bench attempt on the page's feed: the bar already tapped on the hooks (look 5.14c, filmed again), the camera's
 * frames every DT, each handed to the frame callback if it fires, and the refresh tick every TICK, which reads the
 * video's currentTime (it moves while the camera plays) and the newest picture.
 */
function attempt(o: Sim, has = true) {
  const segs = o.segs ?? BENCH;
  const ml = new MeetLift(DIMS, 'bench', { atTap: true });
  expect(ml.tapBar(frame(...RACK, 0), ...RACK, 0)).toBe(true);
  const pick = new CadencePick(has);
  const feed = new BarFeed(ml, pick, T0);
  const evs: MeetEvent[] = [];
  const until = o.until ?? lengthOf(segs) + 25_000;
  let k = 0, newest: { k: number; t: number } | null = null, lastTickK = -1, frozenK: number | null = null;
  const picture = (n: number, t: number) => {
    if (o.freezeAt !== undefined && t >= o.freezeAt) frozenK ??= n;
    const kk = frozenK ?? n;
    return frame(...posAt(RACK, segs, frozenK !== null ? Math.min(t, o.freezeAt!) : t), kk);
  };
  const done = () => evs.some(e => e.type === 'end');
  for (let ms = TICK; ms < until && !done(); ms += TICK) {
    while ((k + 1) * DT <= ms && !done()) {
      k++;
      const t = Math.round(k * DT);
      if (o.stalled?.(t)) continue;
      newest = { k, t };
      if (o.callback?.(k, t)) {
        const r = feed.frame(T0 + t + 7, { captureTime: T0 + t, presentedFrames: k }, () => picture(k, t));
        if (r) evs.push(...r.evs.map(e => ({ ...e, t: e.t })));
      }
    }
    if (done()) break;
    const fresh = !!newest && newest.k !== lastTickK;
    const n = newest;
    if (n) lastTickK = n.k;
    // a camera stream's currentTime runs on with the clock while it plays (3.2, tried on Chrome's fake camera)
    const media = n && !o.stalled?.(Math.round(ms)) ? ms / 1000 : (n?.t ?? 0) / 1000;
    evs.push(...feed.tick(T0 + ms, media, fresh, () => (n ? picture(n.k, n.t) : null)));
  }
  const said = evs.flatMap(e => (e.type === 'call' || e.type === 'end' ? [e.key] : []));
  const end = evs.find(e => e.type === 'end') as Extract<MeetEvent, { type: 'end' }> | undefined;
  const at = (key: string) => evs.find(e => (e.type === 'call' || e.type === 'end') && e.key === key)?.t ?? null;
  return { ml, pick, evs, said, end, at };
}

const always = () => true;

describe('frameTimeOf: a camera frame\'s own time (3.2)', () => {
  it('takes captureTime, else expectedDisplayTime, else when the callback ran', () => {
    expect(frameTimeOf({ captureTime: 10, expectedDisplayTime: 20 }, 30)).toBe(10);
    expect(frameTimeOf({ captureTime: 0, expectedDisplayTime: 20 }, 30)).toBe(20);
    expect(frameTimeOf({ expectedDisplayTime: Number.NaN }, 30)).toBe(30);
    expect(frameTimeOf(null, 30)).toBe(30);
  });
});

describe('CadencePick: the fallback, chosen by what happens (3.2)', () => {
  it('starts on "refresh" where the browser has no callback', () => {
    const p = new CadencePick(false);
    expect(p.cadence).toBe('refresh');
    expect(p.tick(0, 0)).toBe(false);
    expect(p.fellBack).toBe(false);
  });
  it('drops to "refresh" after 1 s of playing video with no callback, and not before', () => {
    const p = new CadencePick(true);
    p.tick(0, 0);
    // the video hasn't started: no clock yet
    for (let t = 0; t <= 3000; t += TICK) p.tick(t, 0);
    expect(p.cadence).toBe('frame');
    p.tick(3010, 0.01);
    expect(p.tick(3010 + NO_CALLBACK_MS - 20, 0.5)).toBe(false);
    expect(p.tick(3010 + NO_CALLBACK_MS, 1)).toBe(true);
    expect(p.cadence).toBe('refresh');
    expect(p.fellBack).toBe(true);
    // on "refresh" a late callback isn't the bar's
    expect(p.frame({ presentedFrames: 1 })).toBe(false);
  });
  it('never switches once a callback has come', () => {
    const p = new CadencePick(true);
    p.tick(0, 0); p.tick(10, 0.01);
    expect(p.frame({ presentedFrames: 1 })).toBe(true);
    for (let t = 10; t < 10_000; t += TICK) p.tick(t, t / 1000);
    expect(p.cadence).toBe('frame');
    expect(p.fellBack).toBe(false);
  });
  it('counts skipped frames from presentedFrames', () => {
    const p = new CadencePick(true);
    for (const n of [1, 3, 5, 6, 8]) p.frame({ presentedFrames: n });
    expect(p.frames).toBe(5);
    expect(p.skipped).toBe(3);
    expect(p.skippedRate).toBe(0.375);
    expect(new CadencePick(true).skippedRate).toBeNull();
  });
});

describe('the bench on the page\'s feed (item 114)', () => {
  it('on "frame", every camera frame is fed once, at its own time: "Start!", "Press!", "Rack!"', () => {
    const r = attempt({ callback: always });
    expect(r.pick.cadence).toBe('frame');
    expect(r.said).toEqual(['start', 'press', 'rack']);
    const path = r.ml.bar!.path;
    // one point per camera frame, on the frames' times (DT apart), never the tick's
    const gaps = path.slice(1).map((p, i) => Math.round(p.t - path[i].t));
    expect(new Set(gaps)).toEqual(new Set([33, 34]));
    expect(path.every(p => Number.isInteger(p.t) || Math.abs(p.t - Math.round(p.t)) < 1e-9)).toBe(true);
  });

  it('a callback that exists but never fires (a canvas stream never drawn): to the tick after 1 s, "refresh", and "Start!" on a still hold', () => {
    const r = attempt({ callback: () => false });
    expect(r.pick.fellBack).toBe(true);
    expect(r.pick.cadence).toBe('refresh');
    expect(r.said).toEqual(['start', 'press', 'rack']);
    // "Bar is loaded." comes with the first tick that feeds a frame, just after the 1 s
    const loaded = r.evs.find(e => e.type === 'loaded')!;
    expect(loaded.t).toBeGreaterThanOrEqual(NO_CALLBACK_MS);
    expect(loaded.t).toBeLessThan(NO_CALLBACK_MS + 100);
  });

  it('frames that come, then stop for good: that attempt ends as a lost bar, and the next drops to the tick and gets "Start!"', () => {
    // the callback dies 1 s after "Start!" would come; the video plays on
    const first = attempt({ callback: (_k, t) => t < 4300 });
    expect(first.pick.cadence).toBe('frame');
    expect(first.pick.fellBack).toBe(false);
    expect(first.said[0]).toBe('start');
    expect(first.end).toMatchObject({ key: 'rack', rackWhy: 'lost' });
    // never left on a lasting "lost": the end comes within the bar's lost-late and lost-rack rules
    expect(first.at('rack')! - first.at('start')!).toBeLessThan(8000);
    // the next attempt, on the same dead callback
    const next = attempt({ callback: () => false });
    expect(next.pick.fellBack).toBe(true);
    expect(next.said).toEqual(['start', 'press', 'rack']);
  });

  it('a single 1 s stop after frames have come doesn\'t switch, and item 112\'s void fires', () => {
    // off the hooks and held at arms' length, the camera stalls for 1 s before "Start!"
    const r = attempt({ callback: always, stalled: t => t >= 2300 && t < 3300 });
    expect(r.pick.cadence).toBe('frame');
    expect(r.pick.fellBack).toBe(false);
    expect(r.said).toEqual(['rack']);
    expect(r.end).toMatchObject({ key: 'rack', void: true });
  });

  it('a tracker slowed to skip every other frame still reads a frozen 1 s as stuck', () => {
    // the picture freezes just off the hooks, within freezeNearTapPct of her tap, before "Start!"
    const hold = 1500 + 250;
    const half = attempt({ callback: k => k % 2 === 0, freezeAt: hold, until: hold + 1000 });
    expect(half.pick.skippedRate).toBeGreaterThan(0.45);
    expect(half.pick.skippedRate).toBeLessThan(0.55);
    expect(half.ml.bar!.bar!.frozeAt.length).toBeGreaterThan(0);
    // and the full camera, the same
    const full = attempt({ callback: always, freezeAt: hold, until: hold + 1000 });
    expect(full.pick.skippedRate).toBe(0);
    expect(full.ml.bar!.bar!.frozeAt.length).toBeGreaterThan(0);
  });
});

describe('sentPath: the bar_path the page sends (item 110)', () => {
  it('is on the clip\'s clock from "Bar is loaded.", strictly increasing, rounded, with lost as 0 or 1', () => {
    const p = sentPath([
      { t: 90, x: 0.1, y: 0.2, score: 0.9, lost: false },
      { t: 100.4, x: 0.123456, y: 0.654321, score: 0.98765, lost: false },
      { t: 133.6, x: 0.2, y: 0.3, score: 0.2, lost: true },
      { t: 133.9, x: 0.2, y: 0.3, score: 0.2, lost: true },
      { t: 167, x: 0.3, y: 0.4, score: 0.95, lost: false },
    ], 100);
    expect(p).toEqual([[0, 0.1235, 0.6543, 0.99, 0], [34, 0.2, 0.3, 0.2, 1], [67, 0.3, 0.4, 0.95, 0]]);
  });
  it('what the page sends from a real attempt on "frame" passes the server\'s checks', () => {
    const r = attempt({ callback: always });
    const zero = r.evs.find(e => e.type === 'loaded')!.t;
    const p = sentPath(r.ml.bar!.path, zero);
    expect(p.length).toBeGreaterThan(100);
    expect(p.every((q, i) => i === 0 || q[0] > p[i - 1][0])).toBe(true);
    expect(p.every(q => q[1] >= 0 && q[1] <= 1 && q[2] >= 0 && q[2] <= 1)).toBe(true);
  });
});

// keep the type used so a change to FrameMeta's fields shows here
const _meta: FrameMeta = { captureTime: 1, expectedDisplayTime: 2, presentedFrames: 3 };
void _meta;
