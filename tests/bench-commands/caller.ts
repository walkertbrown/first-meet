// The bench caller under test is the one the phone runs: web/lib/judge/bar-caller.ts (plan 3.4b, item 74).
// Its numbers are shared/rules.json `benchBar`. Kept under the names score.ts and the unit test use.
// `Rel` adds item 109's trial rule (frozenPressMs), which the product's rules don't set.
import type { BarRel, FrozenPress } from '../../web/lib/judge/bar-caller';
export { BarCaller as BenchCaller, BAR_RULES as RULES, BAR_STUCK as STUCK, type BarCmd } from '../../web/lib/judge/bar-caller';
export type Rel = BarRel & FrozenPress;
