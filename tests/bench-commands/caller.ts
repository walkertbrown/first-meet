// The bench caller under test is the one the phone runs: web/lib/judge/bar-caller.ts (plan 3.4b, item 74).
// Its numbers are shared/rules.json `benchBar`. Kept under the names score.ts and the unit test use.
export { BarCaller as BenchCaller, BAR_RULES as RULES, BAR_STUCK as STUCK, type BarRel as Rel, type BarCmd } from '../../web/lib/judge/bar-caller';
