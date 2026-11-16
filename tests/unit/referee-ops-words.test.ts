// /ops's referee bot lines (plan 2.4, 3.4d steps 7 and 10).
import { describe, expect, it } from 'vitest';
import { botRows, notRunningLine, TEST_ANSWER_CHOICES, type BotOpsView } from '@/lib/referee/ops-words';
import { TEST_ANSWERS } from '@/lib/referee/lamps';

const base: BotOpsView = {
  on: false, key: false, notRunning: null, waiting: 0, medianS: null, decidedHour: 0,
  cost: { usd: 0, jobs: 0 }, spendLimitUsd: 100, testAnswersAllowed: false, testAnswers: null,
};

describe("/ops's referee bot", () => {
  it('the red line names the reason, and is absent when nothing is wrong', () => {
    expect(notRunningLine({ notRunning: 'spend limit reached' })).toBe('Referee bot not running: spend limit reached');
    expect(notRunningLine({ notRunning: null })).toBeNull();
  });

  it('off is a neutral row, never red', () => {
    const rows = botRows(base);
    expect(rows[0]).toEqual({ label: 'Referee bot', value: 'Off' });
    expect(rows.some(r => r.over)).toBe(false);
  });

  it('the month\'s cost against the $100 spend limit, red once it is reached', () => {
    expect(botRows({ ...base, cost: { usd: 12.345, jobs: 60 } }).find(r => r.label === 'Spent this month')).toEqual({ label: 'Spent this month', value: '$12.35 of $100.00', over: false });
    expect(botRows({ ...base, cost: { usd: 100, jobs: 500 } }).find(r => r.label === 'Spent this month')?.over).toBe(true);
  });

  it('the median from frames ready to lights in seconds, a dash with none', () => {
    expect(botRows({ ...base, medianS: 94.6 }).find(r => r.label.startsWith('Frames ready'))?.value).toBe('95 s');
    expect(botRows(base).find(r => r.label.startsWith('Frames ready'))?.value).toBe('—');
  });

  it("the staging choice is step 7's six, in its order, Real first", () => {
    expect(TEST_ANSWER_CHOICES.map(c => c.label)).toEqual(['Real', 'No key', 'Spend limit reached', 'Errors for 30 minutes', 'Red, white, white', 'Not sure, twice']);
    expect(TEST_ANSWER_CHOICES.slice(1).map(c => c.value).sort()).toEqual([...TEST_ANSWERS].sort());
  });
});
