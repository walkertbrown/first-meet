// Bench commands test (plan 3.4b, item 74): the committed scoring gives the committed results, and the caller never
// looks ahead (a command's time is the same whether or not the frames after it exist).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BenchCaller, RULES } from '../bench-commands/caller';
import { score } from '../bench-commands/score';

const B = join(__dirname, '..', 'bench-commands');
const results = (f: string) => JSON.parse(readFileSync(join(B, 'results', f), 'utf8'));
const strip = (r: ReturnType<typeof score>) => JSON.parse(JSON.stringify({ lines: r.lines, rows: r.rows }));

describe('bench commands test', () => {
  it('with the whole-frame search, gives results/with-search.json', () => {
    const want = results('with-search.json');
    expect(strip(score(RULES, join(B, 'data', 'traces')))).toEqual({ lines: want.lines, rows: want.rows });
  });

  it('without the search, gives results/no-search.json', () => {
    const want = results('no-search.json');
    expect(strip(score(RULES, join(B, 'data', 'traces-no-search')))).toEqual({ lines: want.lines, rows: want.rows });
  });

  it('with the 0.3 s stuck time, gives results/stuck-0.3s.json', () => {
    const want = results('stuck-0.3s.json');
    const o = JSON.parse(readFileSync(join(B, 'results', 'stuck-0.3s.override.json'), 'utf8'));
    expect(strip(score({ ...RULES, ...o }, join(B, 'data', 'traces-no-search')))).toEqual({ lines: want.lines, rows: want.rows });
  });

  for (const dir of ['traces', 'traces-no-search']) {
    it(`never looks ahead (${dir})`, () => {
      const run = (pj: { mark: { x: number; y: number }; w: number; h: number; racked: boolean }, pts: number[][]) => {
        const c = new BenchCaller({ x: pj.mark.x, y: pj.mark.y }, { w: pj.w, h: pj.h }, RULES, pj.racked);
        return pts.map(([t, x, y, s]) => c.feed(t, x, y, s)).filter(Boolean).map(cmd => `${cmd!.cmd}@${cmd!.t}`);
      };
      for (const f of readdirSync(join(B, 'data', dir)).filter(n => n.endsWith('.json'))) {
        const pj = JSON.parse(readFileSync(join(B, 'data', dir, f), 'utf8'));
        const full = run(pj, pj.pts);
        for (let cut = 30; cut < pj.pts.length; cut += 30) {
          const tCut = pj.pts[cut - 1][0];
          expect(run(pj, pj.pts.slice(0, cut)), `${pj.id} cut at ${tCut} ms`).toEqual(full.filter(s => +s.split('@')[1] <= tCut));
        }
      }
    });
  }
});
