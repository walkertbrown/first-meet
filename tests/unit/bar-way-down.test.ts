// 3.4b, "Lost after Start!" (Walker's yes, Nov 26, 12:54 AM), and 3.4's "'Press!' never comes while the bar is still
// going down": the bar lost as she starts down, on the set's two slowest ways down (AMih 3.27 s, KrDo 2.63 s by eye).
// One frame under lostScore, or a 600 ms camera stop, at the eye's start of descent: the late "Press!" 2 s after the
// loss waits while the bar is seen going down, so no "Press!" comes before the bottom, and the pause reads
// "not measured". On "frame" (the bar fed once per camera frame, the refresh tick between) and on "refresh" (the
// tick re-reads the last picture, so a camera stop is a frozen picture, not a gap).
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { BAR_RULES, BarCaller, measureBar, type BarCmd, type BarPoint } from '../../web/lib/judge';
import { sinkAfter } from '../../web/lib/judge/bar-measure';
import { liveFeed } from '../bench-commands/score';

const B = join(__dirname, '../bench-commands/data');
const EYE = JSON.parse(readFileSync(join(B, 'eyetimes.json'), 'utf8')) as Record<string, { descent: number; stop: number; traceFrom?: number }>;
type Trace = { w: number; h: number; racked: boolean; mark: { x: number; y: number }; pts: BarPoint[] };
const trace = (id: string) => JSON.parse(readFileSync(join(B, 'traces', `${id}.json`), 'utf8')) as Trace;
const TICK = 1000 / 60;

/** Runs the caller on `pts`: each point fed, and on "frame" the refresh tick run between them. */
function call(tr: Trace, pts: BarPoint[], cadence: 'frame' | 'refresh') {
  const c = new BarCaller(tr.mark, tr, BAR_RULES, tr.racked);
  const out: BarCmd[] = [];
  const feed = cadence === 'refresh' ? (liveFeed(pts as number[][], 0, 'tick') as BarPoint[]) : pts;
  for (let i = 0; i < feed.length && c.state !== 'done'; i++) {
    const [t, x, y, s] = feed[i];
    const k = c.feed(t, x, y, s); if (k) out.push(k);
    if (cadence === 'frame' && i + 1 < feed.length) {
      for (let m = t + TICK; m < feed[i + 1][0] && c.state !== 'done'; m += TICK) { const q = c.tick(Math.round(m)); if (q) out.push(q); }
    }
  }
  return { out, fed: feed, start: out.find(k => k.cmd === 'start'), press: out.find(k => k.cmd === 'press') };
}

const ctOf = (tr: Trace, out: BarCmd[]) => {
  const ct: Record<string, unknown> = { loaded: tr.pts[0][0], plate_tap: { ...tr.mark, size: 0.05 } };
  for (const k of out) {
    if (k.cmd === 'press' && k.late) { ct.press_late = k.t; if (k.why) ct.press_late_why = k.why; } else if (ct[k.cmd] === undefined) ct[k.cmd] = k.t;
  }
  return ct as never;
};

for (const id of ['AMih', 'KrDo']) {
  const tr = trace(id), eye = EYE[id];
  const ms = (s: number) => Math.round(s * 1000);
  const descent = ms(eye.descent), stop = ms(eye.stop);
  // the eye's times are the clip's own, as the trace's
  const asFilmed = call(tr, tr.pts, 'frame');
  /** Not before the eye's stop (less 0.15 s, what the eye's times can tell), and the bar on the phone's trace sinks under
   *  1% of the frame after it (the bench score's line 1). */
  const noPressGoingDown = (fed: BarPoint[], t: number) => {
    expect(t).toBeGreaterThanOrEqual(stop - 150);
    const seen = fed.filter(p => p[3] >= BAR_RULES.lostScore).map(p => ({ t: p[0], y: p[2] }));
    expect(sinkAfter(seen, t, 0.01)!).toBeLessThan(0.01);
  };
  describe(`${id}, lost as she starts down (way down ${(eye.stop - eye.descent).toFixed(2)} s by eye)`, () => {
    it('as filmed: Start! before the descent, and no Press! before the bottom', () => {
      expect(asFilmed.start!.t).toBeLessThan(descent);
      // AMih as filmed gets no Press! at all: she followed a real referee, not the phone (the bench score holds her)
      if (asFilmed.press) noPressGoingDown(tr.pts, asFilmed.press.t);
    });
    for (const cadence of ['frame', 'refresh'] as const) {
      it(`on "${cadence}", one frame under lostScore at the start of descent: Press! (late, lost) only once she's stopped`, () => {
        const i = tr.pts.findIndex(p => p[0] >= descent);
        const pts = tr.pts.map((p, k) => (k === i ? ([p[0], p[1], p[2], 0.1] as BarPoint) : p));
        const r = call(tr, pts, cadence);
        expect(r.press).toMatchObject({ late: true, why: 'lost' });
        expect(r.press!.t).toBeGreaterThanOrEqual(pts[i][0] + BAR_RULES.lostLateMs);
        // inside the eye's tolerance (VibeSearch, 12:55 AM: 0.10 s on AMih is within what the eye times can tell)
        noPressGoingDown(r.fed, r.press!.t);
        expect(measureBar(r.fed, ctOf(tr, r.out), tr).pause_s).toBeNull();
      });
      it(`on "${cadence}", a 600 ms camera stop at the start of descent: no Press! before the bottom`, () => {
        const pts = tr.pts.filter(p => p[0] < descent || p[0] >= descent + 600);
        const r = call(tr, pts, cadence);
        // AMih on "refresh" gets no Press! (a frozen picture under 800 ms isn't a loss, and she followed a real referee)
        if (r.press) noPressGoingDown(r.fed, r.press.t);
        if (cadence === 'frame') {
          // a stop of 500 ms or more is a loss: Press! late, why lost, and the pause not measured
          expect(r.press).toMatchObject({ late: true, why: 'lost' });
          expect(measureBar(r.fed, ctOf(tr, r.out), tr).pause_s).toBeNull();
        }
      });
    }
  });
}
