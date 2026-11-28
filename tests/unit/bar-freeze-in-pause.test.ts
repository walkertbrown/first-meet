// Item 116 (3.4b, the Playner's 1:03 AM ruling): after a normal "Press!", the stuck guard counts stuck time from the
// later of the stretch's start and "Press!", never back across it. 3.4b's frozen-pause test, on the bench clips: the
// picture freezes 0.2 s and 0.5 s into her pause (the eye's stop) and stays frozen, on "refresh" (the tick re-reads the
// same picture), and the frames stop there for good on "frame". "Rack!" comes no more than about 4.5 s after "Press!",
// with `rack_why: lost`, never at the 20 s no-rep.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { BAR_RULES, BarCaller, type BarCmd, type BarPoint } from '../../web/lib/judge';

const B = join(__dirname, '../bench-commands/data');
type Eye = { grp: string; stop: number; pauseEnd: number; bottom: number };
const EYE = JSON.parse(readFileSync(join(B, 'eyetimes.json'), 'utf8')) as Record<string, Eye>;
type Trace = { w: number; h: number; racked: boolean; mark: { x: number; y: number }; pts: BarPoint[] };
const TICK = 1000 / 60;
const RULES = BAR_RULES;
const ms = (s: number) => Math.round(s * 1000);
// Meet clips with a pause of at least 0.5 s by eye, so both freezes fall in it, and where the phone calls Start! on
// the clip as filmed (on Nazt and uGCh she followed a real referee and the bench score holds her for Start!; that hold
// is the bench score's, not this test's).
const startsAsFilmed = (id: string) => {
  const tr = JSON.parse(readFileSync(join(B, 'traces', `${id}.json`), 'utf8')) as Trace;
  const c = new BarCaller(tr.mark, tr, BAR_RULES, tr.racked);
  for (const [t, x, y, s] of tr.pts) { const k = c.feed(t, x, y, s); if (k) return k.cmd === 'start'; }
  return false;
};
const CLIPS = Object.entries(EYE).filter(([id, e]) => e.grp === 'meet' && e.pauseEnd - e.stop >= 0.5 && startsAsFilmed(id)).map(([id]) => id);

/** The clip up to `from`, then on "refresh" the last picture re-read every tick, and on "frame" no more frames, only the tick. */
function run(tr: Trace, from: number, cadence: 'refresh' | 'frame') {
  const c = new BarCaller(tr.mark, tr, RULES, tr.racked);
  const out: BarCmd[] = [];
  const push = (k: BarCmd | null) => { if (k) out.push(k); };
  const before = tr.pts.filter(p => p[0] < from);
  for (let i = 0; i < before.length && c.state !== 'done'; i++) {
    const [t, x, y, s] = before[i];
    push(c.feed(t, x, y, s));
    if (cadence === 'frame' && i + 1 < before.length)
      for (let m = t + TICK; m < before[i + 1][0] && c.state !== 'done'; m += TICK) push(c.tick(Math.round(m)));
  }
  const [t0, x, y] = before.at(-1)!;
  for (let m = t0 + TICK; m < t0 + 30000 && c.state !== 'done'; m += TICK) {
    // a frozen picture: the same spot, and the tracker sure of it
    push(cadence === 'refresh' ? c.feed(Math.round(m), x, y, Math.max(0.995, before.at(-1)![3])) : c.tick(Math.round(m)));
  }
  return { out, press: out.find(k => k.cmd === 'press'), rack: out.find(k => k.cmd === 'rack'), c };
}

describe('a picture that freezes in her pause (item 116, guard from Press!)', () => {
  it('runs on at least 5 bench clips', () => expect(CLIPS.length).toBeGreaterThanOrEqual(5));
  for (const id of CLIPS) {
    const tr = JSON.parse(readFileSync(join(B, 'traces', `${id}.json`), 'utf8')) as Trace;
    for (const into of [200, 500]) for (const cadence of ['refresh', 'frame'] as const) {
      it(`${id}, frozen ${into} ms into the pause, on "${cadence}": Rack! (lost) within about 4.5 s of Press!`, () => {
        const r = run(tr, ms(EYE[id].stop) + into, cadence);
        expect(r.press).toBeTruthy();
        expect(r.rack).toMatchObject({ rackWhy: 'lost' });
        expect(r.rack!.noRep).toBeFalsy();
        expect(r.rack!.t - r.press!.t).toBeLessThanOrEqual(BAR_RULES.freezeAfterMs + BAR_RULES.lostRackMs + 100);
        // nothing from before Press! is blanked
        for (const f of r.c.frozeFrom) if (f > ms(EYE[id].stop) - 2000 && r.c.state !== 'waiting') expect(f).toBeGreaterThanOrEqual(r.press!.t - 1);
      });
    }
  }
});
