// The Playner's 9:11 AM sweep (3.4b, item 111): before Start!, the 0.99 stuck rule counted only near her tap.
// Free and local: the built caller on every rep of the set (ALL_REPS), at the grid, the 16.7 ms tick and each frame fed
// 3 times, with the scores as recorded and every score lifted to 0.995 (the stand-in's held frames too), plus m-k8 with
// her tap moved to 9.0 s.
//
// Usage: TSX_TSCONFIG_PATH=web/tsconfig.json npx tsx tests/bench-commands/sweep-near-tap.ts [out.json]
import { writeFileSync } from 'node:fs';
import { RULES, type Rel } from './caller';
import { score, type Live, type Row } from './score';

const MK8 = 'm-k8mm8-HTg', MK8_TAP = 9000, LIFT = 0.995;
const ROWS: { name: string; o: Partial<Rel> }[] = [
  { name: "today's rule (0.4 s, anywhere before Start!)", o: {} },
  { name: 'near the tap, D = 5%', o: { freezeNearTap: 0.05 } },
  { name: 'near the tap, D = 6%', o: { freezeNearTap: 0.06 } },
  { name: 'near the tap, D = 8%', o: { freezeNearTap: 0.08 } },
  { name: 'off before Start!', o: { freezeBeforeMs: 0 } },
];
const CADENCES: (Live | undefined)[] = [undefined, 'tick', 'three'];
const tag = (r: Row) => r.id.slice(0, r.id.startsWith('ak3m') ? 5 : 4) + (r.rep > 1 ? `-r${r.rep}` : '');
/** The stuck rule's loss before Start! inside her real hold: from the eye's settled to descent (the trace's own times,
 *  the descent moved by her wait for Start!). */
const holdVoid = (r: Row) => r.stuckBeforeStart && r.lostBeforeStart! >= r.settled && r.lostBeforeStart! <= r.descent;

const out: unknown[] = [];
for (const row of ROWS) for (const lift of [undefined, LIFT]) for (const live of CADENCES) {
  const rules = { ...RULES, ...row.o };
  const { rows, lines } = score(rules, undefined, { allReps: true, live, lift });
  const mk8 = rows.find(r => r.id === MK8)!;
  const moved = score(rules, undefined, { live, lift, only: [MK8], tapAt: { [MK8]: MK8_TAP } }).rows[0];
  const startWaits = rows.flatMap(r => r.waits.filter(w => w.what === 'start').map(w => ({ id: tag(r), s: w.s, got: w.got })));
  const longest = startWaits.reduce((a, w) => (w.s > a.s ? w : a), { id: '-', s: 0, got: true });
  const res = {
    row: row.name, scores: lift ? `lifted to ${LIFT}` : 'as recorded', cadence: live ?? 'grid',
    lines: Object.fromEntries((['line1', 'line2', 'line3', 'line4'] as const).map(k => [k, lines[k].status])),
    line2: lines.line2.text,
    holdsVoided: rows.filter(holdVoid).map(tag),
    // VibeSearch (9:14 AM): judge it on the 13 clips she taps on the hooks; 9 open with the bar out (the mark is the hold)
    racked: rows.filter(r => r.rep === 1 && !r.inHand).length,
    holdsVoidedRacked: rows.filter(r => holdVoid(r) && r.rep === 1 && !r.inHand).map(tag),
    holdsVoidedOut: rows.filter(r => holdVoid(r) && r.rep === 1 && r.inHand).map(tag),
    holdsVoidedLater: rows.filter(r => holdVoid(r) && r.rep > 1).map(tag),
    stuckBeforeStart: rows.filter(r => r.stuckBeforeStart).map(r => `${tag(r)} ${r.lostBeforeStart!.toFixed(2)}`),
    noStart: rows.filter(r => r.start == null).map(tag),
    mk8: { start: mk8.start, startEarly: mk8.startEarly, log: mk8.log.join(', ') },
    mk8TapAt9: { start: moved.start, holdVoided: holdVoid(moved), lost: moved.lostBeforeStart, settled: moved.settled, descent: moved.descent, log: moved.log.join(', ') },
    vmy: rows.filter(r => r.id.startsWith('VM_y')).map(r => `${tag(r)}: ${r.start != null ? `Start! ${r.start.toFixed(2)}` : `no Start!${r.voided != null ? `, void ${r.voided.toFixed(2)}` : ''}${r.stuckBeforeStart ? ' (stuck)' : ''}`}`),
    longestStartWait: longest,
  };
  out.push(res);
  const L = res.lines;
  console.log(`${row.name.padEnd(46)} ${res.scores.padEnd(16)} ${res.cadence.padEnd(5)} | ${L.line1} ${L.line2} ${L.line3} ${L.line4}` +
    ` | holds voided: racked ${res.holdsVoidedRacked.length}/${res.racked} (${res.holdsVoidedRacked.join(' ') || '-'}), out ${res.holdsVoidedOut.join(' ') || '-'}, later reps ${res.holdsVoidedLater.join(' ') || '-'}` +
    ` | m-k8 Start! ${mk8.start?.toFixed(2) ?? 'none'}${mk8.startEarly ? ' EARLY' : ''}` +
    ` | m-k8 tap 9.0: ${moved.start != null ? `Start! ${moved.start.toFixed(2)}` : 'no Start!'}${holdVoid(moved) ? ' (hold voided)' : ''}` +
    ` | VM_y ${res.vmy.join('; ')} | longest wait ${longest.s.toFixed(2)} s ${longest.id}${longest.got ? '' : ' (none came)'}`);
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(out, null, 1) + '\n');
