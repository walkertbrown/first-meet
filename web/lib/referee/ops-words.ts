// /ops's lines about the referee bot (plan 2.4, 3.4d steps 7, 9 and 10, item 103's switch).
import type { OpsRow } from '@/lib/ops';
import type { TestAnswers } from '@/lib/referee/lamps';

export type BotOpsView = {
  on: boolean; key: boolean; notRunning: string | null; waiting: number; medianS: number | null; decidedHour: number;
  cost: { usd: number; jobs: number }; spendLimitUsd: number; testAnswersAllowed: boolean; testAnswers: TestAnswers | null;
};

/** Step 7's choice, in its order; "Real" is no test answer. */
export const TEST_ANSWER_CHOICES: { value: TestAnswers | 'real'; label: string }[] = [
  { value: 'real', label: 'Real' },
  { value: 'no_key', label: 'No key' },
  { value: 'spend_limit', label: 'Spend limit reached' },
  { value: 'errors_30m', label: 'Errors for 30 minutes' },
  { value: 'red_white_white', label: 'Red, white, white' },
  { value: 'not_sure_twice', label: 'Not sure, twice' },
  { value: 'spot_weight_1', label: 'Spot check: weight not visible on attempt 1' },
];

export const notRunningLine = (b: Pick<BotOpsView, 'notRunning'>) => (b.notRunning ? `Referee bot not running: ${b.notRunning}` : null);

const usd = (n: number) => `$${n.toFixed(2)}`;

export function botRows(b: BotOpsView): OpsRow[] {
  return [
    // item 103: off until the referee bot test passes. Off is the plan's state, so never red.
    { label: 'Referee bot', value: b.on ? 'On' : 'Off' },
    { label: 'Key', value: b.key ? 'Set' : 'Not set' },
    { label: 'Waiting', value: String(b.waiting) },
    { label: 'Frames ready to lights, median, 1 h', value: b.medianS === null ? '—' : `${Math.round(b.medianS)} s` },
    { label: 'Decided this hour', value: String(b.decidedHour) },
    { label: 'Spent this month', value: `${usd(b.cost.usd)} of ${usd(b.spendLimitUsd)}`, over: b.cost.usd >= b.spendLimitUsd },
  ];
}
