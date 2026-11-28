// Spot checks' pure parts (plan 3.4d step 8, 5.31, 5.33; item 104): reading the bot's answer, what
// counts as a problem, the second call, the lines /referee/spot and /results show.
import { describe, expect, it } from 'vitest';
import type { RefereeCall } from '@/db/schema';
import {
  SPOT_SCHEMA, askSpot, botLine, fakeSpotCall, parseSpot, resultsLine, spotFinding, startMs, totalLine, type SpotOutcome,
} from '@/lib/referee/spot';

const call: RefereeCall = { lamp: 'spot', try: 1, model: 'm', stop: 'end_turn', input: 0, cache_write: 0, cache_read: 0, output: 0, cost_usd: 0, ms: 0 };
const all = (over: Partial<{ weight_visible: boolean; weight_sure: boolean; arms_bent: boolean; arms_sure: boolean }> = {}, at = 1) =>
  [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ attempt: n, weight_visible: true, weight_sure: true, arms_bent: false, arms_sure: true, ...(n === at ? over : {}) }));
const byN = (press = false) => new Map([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [n, { id: `a${n}`, press: press && n >= 4 && n <= 6 }]));

describe('spot checks', () => {
  it('the schema asks for every field, strictly', () => {
    expect(SPOT_SCHEMA.required).toEqual(['attempts', 'same_lifter', 'same_lifter_sure', 'note']);
    expect(SPOT_SCHEMA.properties.attempts.items.additionalProperties).toBe(false);
  });

  it('reads an answer, and refuses one it cannot read', () => {
    const a = parseSpot(JSON.stringify({ attempts: all(), same_lifter: 'true', same_lifter_sure: true, note: '  Plates clear.  ' }));
    expect(a).toMatchObject({ same_lifter: 'true', note: 'Plates clear.' });
    expect(a!.attempts).toHaveLength(9);
    expect(parseSpot('not json')).toBeNull();
    expect(parseSpot(JSON.stringify({ attempts: [], same_lifter: 'maybe', note: '' }))).toBeNull();
  });

  it('only a sure answer is a problem; arms count only on the Home press', () => {
    const base = { same_lifter: 'true' as const, same_lifter_sure: true, note: '' };
    expect(spotFinding({ ...base, attempts: all() }, byN())).toEqual({ outcome: 'checked', problems: [] });
    expect(spotFinding({ ...base, attempts: all({ weight_visible: false, weight_sure: false }) }, byN()).outcome).toBe('checked');
    expect(spotFinding({ ...base, attempts: all({ weight_visible: false }) }, byN()))
      .toEqual({ outcome: 'problem', problems: [{ kind: 'weight_not_visible', attemptId: 'a1' }] });
    expect(spotFinding({ ...base, attempts: all({ arms_bent: true }, 4) }, byN()).outcome).toBe('checked');
    expect(spotFinding({ ...base, attempts: all({ arms_bent: true }, 4) }, byN(true)).problems).toEqual([{ kind: 'arms_bent', attemptId: 'a4' }]);
    expect(spotFinding({ ...base, attempts: all({ arms_bent: true, arms_sure: false }, 4) }, byN(true)).outcome).toBe('checked');
    expect(spotFinding({ ...base, same_lifter: 'false', attempts: all() }, byN()).problems).toEqual([{ kind: 'not_same_lifter' }]);
    expect(spotFinding({ ...base, same_lifter: 'false', same_lifter_sure: false, attempts: all() }, byN()).outcome).toBe('checked');
    expect(spotFinding({ ...base, same_lifter: 'not_sure', attempts: all() }, byN()).outcome).toBe('checked');
  });

  it('the test answer fakes only what Anthropic sends: attempt 1 weight not visible, sure', () => {
    const o = fakeSpotCall([1, 2, 3, 4, 5, 6, 7, 8, 9], 1);
    expect(o.kind).toBe('answer');
    if (o.kind === 'answer') expect(spotFinding(o.answer, byN()).problems).toEqual([{ kind: 'weight_not_visible', attemptId: 'a1' }]);
  });

  it('one more call when unreadable or failing; unreadable twice is checked, errors twice a failed try, spend at once', async () => {
    const seq = (...o: SpotOutcome[]) => { let i = 0; return async () => o[i++]; };
    const unsure: SpotOutcome = { kind: 'unsure', why: 'unreadable', call };
    const err: SpotOutcome = { kind: 'error', why: 'boom', spend: false, call };
    const spend: SpotOutcome = { kind: 'error', why: 'limit', spend: true, call };
    const ok = fakeSpotCall([1], 2);
    expect(await askSpot(seq(unsure, ok))).toMatchObject({ kind: 'answer', calls: [call, ok.call] });
    expect(await askSpot(seq(unsure, unsure))).toMatchObject({ kind: 'answer', answer: null });
    expect(await askSpot(seq(err, err))).toMatchObject({ kind: 'failed', why: 'boom', spend: false });
    expect(await askSpot(seq(err, unsure))).toMatchObject({ kind: 'answer', answer: null });
    expect((await askSpot(seq(spend, ok))).calls).toHaveLength(1);
  });

  it('"Start!" is the first command after set-up', () => {
    expect(startMs({ loaded: 200, squat: 1500, rack: 6000 })).toBe(1500);
    expect(startMs({ loaded: 200, start: 1000, press: 3000 })).toBe(1000);
    expect(startMs({ loaded: 400 })).toBe(400);
    expect(startMs(null)).toBeNull();
  });

  it("the lines on /referee/spot, /results and her total page", () => {
    const label = (id: string) => (id === 'a1' ? 'Squat 1' : id);
    expect(botLine({ bot: { outcome: 'checked', problems: [] }, job: null, botOn: true }, label)).toBe('Checked by the referee bot.');
    expect(botLine({ bot: { outcome: 'problem', problems: [{ kind: 'weight_not_visible', attemptId: 'a1' }] }, job: null, botOn: true }, label))
      .toBe('Referee bot: weight not visible on Squat 1.');
    expect(botLine({ bot: { outcome: 'doubt', problems: [] }, job: null, botOn: true }, label)).toMatch(/counts as checked/);
    expect(botLine({ bot: null, job: { status: 'ready' }, botOn: true }, label)).toBe('The referee bot is checking.');
    expect(botLine({ bot: null, job: null, botOn: false }, label)).toBe('Waiting for a referee.');
    expect(resultsLine({ bot: { outcome: 'checked', problems: [] }, person: null })).toBe('Checked by the referee bot');
    expect(resultsLine({ bot: { outcome: 'doubt', problems: [] }, person: null })).toBeNull();
    expect(resultsLine({ bot: null, person: { outcome: 'checked', problems: [] } })).toBe('Checked by a referee');
    expect(resultsLine(null)).toBeNull();
    expect(totalLine('Squat', 1)).toBe('A spot check found a problem with your Squat 1, so your total changed.');
  });
});
