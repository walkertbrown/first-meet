// Bench commands test (plan 3.4b, item 74): the committed scoring gives the committed results, every line passes, and the
// caller never looks ahead (a command's time is the same whether or not the frames after it exist).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BenchCaller, RULES } from '../bench-commands/caller';
import { score } from '../bench-commands/score';

const B = join(__dirname, '..', 'bench-commands');

describe('bench commands test', () => {
  const got = score();

  it('gives results/commands.json', () => {
    const want = JSON.parse(readFileSync(join(B, 'results', 'commands.json'), 'utf8'));
    expect(JSON.parse(JSON.stringify({ rules: RULES, lines: got.lines, notes: got.notes, rows: got.rows }))).toEqual(want);
  });

  // Line 1 may be "not shown on clips" (too few reps get Press! in the clip itself), but never failed. The rest must pass.
  it('line1 does not fail', () => expect(got.lines.line1.status, got.lines.line1.text).not.toBe('FAIL'));
  for (const [k, l] of Object.entries(got.lines)) if (k !== 'line1') it(`${k} passes`, () => expect(l.status, l.text).toBe('PASS'));

  it('never looks ahead', () => {
    const run = (pj: { mark: { x: number; y: number }; w: number; h: number; racked: boolean }, pts: number[][]) => {
      const c = new BenchCaller({ x: pj.mark.x, y: pj.mark.y }, { w: pj.w, h: pj.h }, RULES, pj.racked);
      return pts.map(([t, x, y, s]) => c.feed(t, x, y, s)).filter(Boolean).map(cmd => `${cmd!.cmd}${cmd!.void ? '(void)' : ''}@${cmd!.t}`);
    };
    for (const f of readdirSync(join(B, 'data', 'traces')).filter(n => n.endsWith('.json'))) {
      const pj = JSON.parse(readFileSync(join(B, 'data', 'traces', f), 'utf8'));
      const full = run(pj, pj.pts);
      for (let cut = 30; cut < pj.pts.length; cut += 30) {
        const tCut = pj.pts[cut - 1][0];
        expect(run(pj, pj.pts.slice(0, cut)), `${pj.id} cut at ${tCut} ms`).toEqual(full.filter(s => +s.split('@')[1] <= tCut));
      }
    }
  });
});
