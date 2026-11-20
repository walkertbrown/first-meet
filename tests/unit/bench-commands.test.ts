// Bench commands test (plan 3.4b, item 74): the committed scoring gives the committed results, every line passes, and the
// caller never looks ahead (a command's time is the same whether or not the frames after it exist).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BenchCaller, RULES } from '../bench-commands/caller';
import { allRepsResults, cadenceMoves, score, type Live } from '../bench-commands/score';

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

  it('never looks ahead, on a frozen track item 109 holds Press! for', () => {
    const run = (pj: { mark: { x: number; y: number }; w: number; h: number }, pts: number[][]) => {
      const c = new BenchCaller({ x: pj.mark.x, y: pj.mark.y }, { w: pj.w, h: pj.h }, RULES, false);
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

// Item 109 (The Playner, Nov 16, 2:23 AM; in the product's rules since Nov 20): every rep of the gym sets. Reps 2 and on
// are the stand-in (laterReps in score.ts): two reps of one clip, her pause played back as held frames. With item 109
// off, IA0P rep 3's Press! comes before the stop while the bar still sinks; with the product's rules (a frozen track
// waits 1.0 s for Press!), no rep is called early, 90% or more come within 1 s, none past 1.5 s but press_late, and
// lines 1-4 pass on every rep, on the traces' grid and at the live cadences (the 16.7 ms tick, each frame fed 3 times).
// Lines 5 and 6 aren't asked of the stand-in: those sets went from rep to rep without settling
// (results/commands-all-reps.json).
describe('bench commands test, every rep (item 109; reps 2 and on are two reps of one clip, the stand-in)', () => {
  const pressLines = (rules: typeof RULES, live?: Live) => {
    const { rows, lines } = score(rules, undefined, { allReps: true, live });
    const sc = rows.filter(r => r.group !== 'bounced');
    return { lines, sc, early: sc.filter(r => r.early).map(r => `${r.id.slice(0, 4)}-r${r.rep}`), within1: sc.filter(r => r.within1).length, over15: sc.filter(r => r.over15).length };
  };
  it('with item 109 off, IA0P rep 3 alone gets Press! before the stop', () => {
    const { early, over15 } = pressLines({ ...RULES, frozenPressMs: 0 });
    expect(early).toEqual(['IA0P-r3']);
    expect(over15).toBe(0);
  });
  for (const live of [undefined, 'tick', 'three'] as const) {
    it(`the product's rules${live ? ` at the live cadence (${live})` : ''}: no Press! before the stop, 90% within 1 s, none past 1.5 s but press_late, lines 1-4`, () => {
      const { lines, sc, early, within1, over15 } = pressLines(RULES, live);
      expect(early).toEqual([]);
      expect(within1).toBeGreaterThanOrEqual(0.9 * sc.length);
      expect(over15).toBe(0);
      expect(lines.line1.status, lines.line1.text).not.toBe('FAIL');
      for (const k of ['line2', 'line3', 'line4'] as const) expect(lines[k].status, lines[k].text).toBe('PASS');
    });
    // NerdCider's gap (Nov 20, 9:01 AM): the set's bench cuts start mid-lift, so only the whole phone path, from the
    // tap, shows a real pause the stuck rule blanks. None of 0.5 s or more (by eye) may read "not measured" for it.
    it(`the product's rules${live ? ` at the live cadence (${live})` : ''}: no real pause of 0.5 s or more blanked by the stuck rule`, () => {
      const blanked = pressLines(RULES, live).sc.filter(r => r.pauseEnd - r.stop >= 0.5 && r.pauseStuck).map(r => `${r.id.slice(0, 4)}-r${r.rep}`);
      expect(blanked).toEqual([]);
    });
  }
  // Item 111's cadence line: a command in the clip may move by at most two of the clip's own camera frames from the
  // grid run. Commands in the stand-in's hold are recorded, not counted. A command on one run only is listed, so a change
  // shows: 8qzW's Rack! falls past the trace's end. (VM_y reps 2 and 4 lost Start! at the live cadences until the stuck
  // rule counted only near the tap, item 111.)
  const grid = score(RULES, undefined, { allReps: true }).rows;
  for (const live of ['tick', 'three'] as const) {
    it(`at the live cadence (${live}), no command in the clip moves by more than two of the clip's own frames`, () => {
      const m = cadenceMoves(grid, score(RULES, undefined, { allReps: true, live }).rows);
      const over = m.filter(x => x.counted && x.frames! > 2).map(x => `${x.id} ${x.cmd} ${x.moved} s (${x.frames} frames)`);
      expect(over).toEqual([]);
      expect(m.filter(x => x.counted).length).toBeGreaterThanOrEqual(40);
      expect(m.filter(x => x.missing).map(x => `${x.id.slice(0, 4)}${x.id.includes('-r') ? x.id.slice(x.id.indexOf('-r')) : ''} ${x.cmd}`))
        .toEqual(['8qzW rack']);
    });
  }
  // Item 111, near the tap (The Playner's ruling, Nov 20, 9:23 AM; the sweep in sweep-near-tap.ts): before Start!, the
  // stuck rule counts only within 8% of her tap. On the 13 clips she taps on the hooks, with every score lifted to 0.995
  // (a phone sharper than the set's), "We lost the bar." never comes before Start! inside her real hold (the eye's
  // settled to descent, in the trace's own times), but on ak3m3 at the tick, which the ruling accepts. The 9 that open
  // with the bar out and the stand-in reps aren't judged on it: their tap is no rack.
  const tag = (r: { id: string; rep: number }) => r.id.slice(0, r.id.startsWith('ak3m') ? 5 : 4) + (r.rep > 1 ? `-r${r.rep}` : '');
  const MK8 = 'm-k8mm8-HTg';
  for (const live of [undefined, 'tick', 'three'] as const) {
    const at = live ? `at the live cadence (${live})` : 'on the grid';
    it(`${at}, scores lifted to 0.995: no real hold on the 13 racked clips is lost before Start!${live === 'tick' ? ' but ak3m3' : ''}`, () => {
      const racked = score(RULES, undefined, { allReps: true, live, lift: 0.995 }).rows.filter(r => r.rep === 1 && !r.inHand);
      expect(racked.length).toBe(13);
      const lost = racked.filter(r => r.lostBeforeStart != null && r.lostBeforeStart >= r.settled && r.lostBeforeStart <= r.descent).map(tag);
      expect(lost.filter(id => !(live === 'tick' && id === 'ak3m3'))).toEqual([]);
    });
    for (const lift of [undefined, 0.995]) {
      const sc = lift ? 'scores lifted to 0.995' : 'scores as recorded';
      it(`${at}, ${sc}: m-k8's racked bar never gets Start!, and with her tap at 9.0 s, her hold does`, () => {
        const mk8 = score(RULES, undefined, { live, lift, only: [MK8] }).rows[0];
        expect(mk8.start, mk8.log.join(', ')).toBeNull();
        const moved = score(RULES, undefined, { live, lift, only: [MK8], tapAt: { [MK8]: 9000 } }).rows[0];
        expect(moved.start, moved.log.join(', ')).not.toBeNull();
        expect(moved.startEarly).toBe(false);
      });
    }
  }
  it('gives results/commands-all-reps.json', () => {
    const want = JSON.parse(readFileSync(join(B, 'results', 'commands-all-reps.json'), 'utf8'));
    expect(JSON.parse(JSON.stringify(allRepsResults()))).toEqual(want);
  });
});
