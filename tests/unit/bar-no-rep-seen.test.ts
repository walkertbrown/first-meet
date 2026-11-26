// 3.4b and 3.2's time rules, item 70: after a normal "Press!", a bar that stays in view and never gets back up (a failed
// rep, on her chest or stuck halfway) gets "Rack!" 20 s after "Press!", `rack_why: no_rep`, on frames alone, with no tick
// between them: on "refresh", where every tick is a frame, and in the server's caller (NerdCider and VibeSearch, Nov 26,
// 1:15 AM, on 1d4cfa2). The bar is held at its last point at a score the stuck guard never marks (under 0.99).
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { BAR_RULES, BarCaller, type BarCmd, type BarPoint } from '../../web/lib/judge';
import { callPath } from '../../web/lib/judge/bar-measure';

const B = join(__dirname, '../bench-commands/data');
type Trace = { w: number; h: number; racked: boolean; mark: { x: number; y: number }; pts: BarPoint[] };
const trace = (id: string) => JSON.parse(readFileSync(join(B, 'traces', `${id}.json`), 'utf8')) as Trace;
const FRAME = 1000 / 30;

/** The clip as filmed up to "Press!", then the bar held where it was for 40 s at `score`, with or without ±0.002 of wobble. */
function heldAfterPress(tr: Trace, score: number, wobble: boolean) {
  const c = new BarCaller(tr.mark, tr, BAR_RULES, tr.racked);
  const pts: BarPoint[] = [];
  let press: BarCmd | null = null;
  for (const p of tr.pts) {
    pts.push(p);
    const k = c.feed(...p);
    if (k?.cmd === 'press') { press = k; break; }
    if (k?.cmd === 'rack') return null;
  }
  if (!press) return null;
  const [t0, x, y] = pts.at(-1)!;
  const out: BarCmd[] = [];
  for (let i = 1, m = t0 + FRAME; m < t0 + 40000 && c.state !== 'done'; i++, m += FRAME) {
    const d = wobble ? (i % 2 ? 0.002 : -0.002) : 0;
    const p: BarPoint = [Math.round(m), x + d, y + d, score];
    pts.push(p);
    const k = c.feed(...p);
    if (k) out.push(k);
  }
  return { press, rack: out.find(k => k.cmd === 'rack'), out, pts };
}

describe('a seen bar that never gets back up after Press! (no-rep, frames only)', () => {
  const CLIPS = ['KrDo', 'Ecs1', 'cE2t'];
  for (const id of CLIPS) for (const score of [0.674, 0.95]) for (const wobble of [false, true]) {
    it(`${id}, held at ${score}${wobble ? ', ±0.002' : ''}: Rack! (no_rep) 20 s after Press!, on the phone and on the server`, () => {
      const tr = trace(id);
      const r = heldAfterPress(tr, score, wobble)!;
      expect(r).toBeTruthy();
      expect(r.out.filter(k => k.cmd !== 'rack')).toEqual([]);
      expect(r.rack).toMatchObject({ noRep: true, rackWhy: 'no_rep' });
      expect(r.rack!.t - r.press.t).toBeGreaterThanOrEqual(BAR_RULES.noRepMs);
      expect(r.rack!.t - r.press.t).toBeLessThan(BAR_RULES.noRepMs + 100);
      // the server's caller on the same path, frames only (it starts on the rack, as her clips do; KrDo's trace starts
      // off it, so the server never calls its Start!)
      if (!tr.racked) return;
      const { server } = callPath(r.pts, { plate_tap: tr.mark } as never, tr);
      const sr = server.find(k => k.cmd === 'rack');
      const sp = server.find(k => k.cmd === 'press');
      expect(sp).toBeTruthy();
      expect(sr).toBeTruthy();
      expect(sr!.t - sp!.t).toBeGreaterThanOrEqual(BAR_RULES.noRepMs);
      expect(sr!.t - sp!.t).toBeLessThan(BAR_RULES.noRepMs + 100);
    });
  }
});
