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

  it('never looks ahead, with item 109\'s trial rule on too', () => {
    const run = (pj: { mark: { x: number; y: number }; w: number; h: number }, pts: number[][]) => {
      const c = new BenchCaller({ x: pj.mark.x, y: pj.mark.y }, { w: pj.w, h: pj.h }, { ...RULES, frozenPressMs: 1000 }, false);
      return pts.map(([t, x, y, s]) => c.feed(t, x, y, s)).filter(Boolean).map(cmd => `${cmd!.cmd}@${cmd!.t}`);
    };
    const pj = JSON.parse(readFileSync(join(B, 'data', 'traces', 'IA0PhDBzsz0.json'), 'utf8'));
    const pts = pj.pts.filter((q: number[]) => q[0] >= 14700);
    const full = run(pj, pts);
    for (let cut = 10; cut < pts.length; cut += 10) {
      const tCut = pts[cut - 1][0];
      expect(run(pj, pts.slice(0, cut)), `cut at ${tCut} ms`).toEqual(full.filter(s => +s.split('@')[1] <= tCut));
    }
  });

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

// Item 109, on trial (The Playner, Nov 16, 2:23 AM): every rep of the gym sets, reps 2 and on with the stand-in (laterReps
// in score.ts). The product's rules call IA0P rep 3's Press! before the stop, while the bar still sinks; with a frozen
// track waiting 1.0 s for Press!, no rep is called early, 90% or more come within 1 s, and none past 1.5 s but press_late.
// Lines 5 and 6 aren't asked of the stand-in: those sets went from rep to rep without settling (results/commands-all-reps.json).
describe('bench commands test, every rep (item 109, on trial)', () => {
  const pressLines = (rules: typeof RULES & { frozenPressMs?: number }) => {
    const { rows } = score(rules, undefined, { allReps: true });
    const sc = rows.filter(r => r.group !== 'bounced');
    return { sc, early: sc.filter(r => r.early).map(r => `${r.id.slice(0, 4)}-r${r.rep}`), within1: sc.filter(r => r.within1).length, over15: sc.filter(r => r.over15).length };
  };
  it('the product\'s rules: IA0P rep 3 alone gets Press! before the stop', () => {
    const { early, over15 } = pressLines(RULES);
    expect(early).toEqual(['IA0P-r3']);
    expect(over15).toBe(0);
  });
  it('the trial rule at 1.0 s: no Press! before the stop, 90% within 1 s, none past 1.5 s but press_late', () => {
    const { sc, early, within1, over15 } = pressLines({ ...RULES, frozenPressMs: 1000 });
    expect(early).toEqual([]);
    expect(within1).toBeGreaterThanOrEqual(0.9 * sc.length);
    expect(over15).toBe(0);
  });
  it('gives results/commands-all-reps.json', () => {
    const want = JSON.parse(readFileSync(join(B, 'results', 'commands-all-reps.json'), 'utf8'));
    const run = (o: object) => { const g = score({ ...RULES, ...o }, undefined, { allReps: true }); return { lines: g.lines, rows: g.rows }; };
    expect(JSON.parse(JSON.stringify({ off: run({}), frozenPressMs1000: run({ frozenPressMs: 1000 }) }))).toEqual(want);
  });
});
