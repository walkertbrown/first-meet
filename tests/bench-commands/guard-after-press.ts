// Item 116 (3.4b, NerdCider's test): the stuck guard after a normal "Press!" cuts no real press short. Every real press
// in the bench set, on the grid and at the live cadences, with scores as filmed and lifted to 0.995 (item 111's
// extra-sure tracker): with the guard on (`true`, or `from`), no rep gets `rack_why: lost`, and no "Rack!" comes earlier than with it off.
// Run: TSX_TSCONFIG_PATH=web/tsconfig.json npx tsx tests/bench-commands/guard-after-press.ts
import { RULES } from './caller';
import { score, type Row } from './score';

export type GuardCase = { live?: 'tick' | 'three'; lift?: number; guard?: true | 'from' };
export const GUARD_CASES: GuardCase[] = [undefined, 'tick' as const, 'three' as const].flatMap(live =>
  [undefined, 0.995].flatMap(lift => [true as const, 'from' as const].map(guard => ({ live, lift, guard }))));

export function guardCheck(cs: GuardCase) {
  const on = score({ ...RULES, guardAfterPress: cs.guard ?? true } as typeof RULES, undefined, { allReps: true, live: cs.live, lift: cs.lift }).rows;
  const off = score({ ...RULES, guardAfterPress: false } as typeof RULES, undefined, { allReps: true, live: cs.live, lift: cs.lift }).rows;
  const key = (r: Row) => `${r.id}`;
  const offBy = new Map(off.map(r => [key(r), r]));
  const lost: string[] = [], earlier: string[] = [], changed: string[] = [];
  let presses = 0;
  for (const r of on) {
    const o = offBy.get(key(r))!;
    if (r.press != null) presses++;
    if (r.press != null && r.rackWhy === 'lost') lost.push(r.id);
    if (o.rack != null && (r.rack == null || r.rack < o.rack - 1e-9)) earlier.push(`${r.id} ${o.rack} -> ${r.rack}`);
    if (r.rack !== o.rack || r.rackWhy !== o.rackWhy || r.press !== o.press) changed.push(`${r.id} rack ${o.rack}/${o.rackWhy} -> ${r.rack}/${r.rackWhy}`);
  }
  // item 111's line: no real pause of 0.5 s or more blanked by the stuck rule (tests/unit/bench-commands.test.ts)
  const blanked = on.filter(r => r.pauseEnd - r.stop >= 0.5 && r.pauseStuck).map(r => r.id);
  return { reps: on.length, presses, lost, earlier, changed, blanked };
}

if (process.argv[1]?.endsWith('guard-after-press.ts')) {
  for (const cs of GUARD_CASES) {
    const g = guardCheck(cs);
    console.log(`guard ${cs.guard}, ${cs.live ?? 'grid'}, ${cs.lift ? `scores lifted to ${cs.lift}` : 'scores as filmed'}: ${g.reps} reps, ${g.presses} presses; ` +
      `rack_why lost: ${g.lost.join(', ') || 'none'}; earlier Rack!: ${g.earlier.join(', ') || 'none'}; changed: ${g.changed.join('; ') || 'none'}; real pause blanked: ${g.blanked.join(', ') || 'none'}`);
  }
}
