// The referee bot's lamps (plan 3.4d steps 3 and 4, item 103): reading an answer, the cost, the
// order the lamps go out in, and the second ask.
import { describe, expect, it } from 'vitest';
import type { RefereeCall } from '@/db/schema';
import { REFEREE_REASONS } from '@/lib/referee';
import {
  askLamps, costOf, fakeCall, isSpendLimit, LAMP_SCHEMA, NOT_SURE_NOTE, parseAnswer, type CallOutcome, type Lamp,
} from '@/lib/referee/lamps';

const call = (lamp: Lamp, t: number): RefereeCall =>
  ({ lamp, try: t, model: 'm', stop: 'end_turn', input: 0, cache_write: 0, cache_read: 0, output: 0, cost_usd: 0, ms: 0 });
const sure = (lamp: Lamp, t: number, light: 'white' | 'red' = 'white'): CallOutcome =>
  ({ kind: 'answer', answer: { light, reason: light === 'red' ? 'depth' : null, rep: null, sure: true, note: 'n' }, call: call(lamp, t) });
const unsure = (lamp: Lamp, t: number): CallOutcome =>
  ({ kind: 'answer', answer: { light: 'white', reason: null, rep: null, sure: false, note: 'n' }, call: call(lamp, t) });
const error = (lamp: Lamp, t: number, spend = false): CallOutcome => ({ kind: 'error', why: spend ? 'spend' : '500', spend, call: call(lamp, t) });

describe('parseAnswer', () => {
  it('reads a white: no reason, no rep, whatever the model put there', () => {
    expect(parseAnswer('{"light":"white","reason":"none","rep":0,"sure":true,"note":"Deep at 2.40 s."}', false, REFEREE_REASONS))
      .toEqual({ light: 'white', reason: null, rep: null, sure: true, note: 'Deep at 2.40 s.' });
  });

  it("reads a red with its reason; a Home red needs the rep, a Barbell red doesn't keep one", () => {
    expect(parseAnswer('{"light":"red","reason":"depth","rep":0,"sure":true,"note":"x"}', false, REFEREE_REASONS))
      .toMatchObject({ light: 'red', reason: 'depth', rep: null });
    expect(parseAnswer('{"light":"red","reason":"no_lockout","rep":3,"sure":true,"note":"x"}', true, REFEREE_REASONS))
      .toMatchObject({ reason: 'no_lockout', rep: 3 });
    expect(parseAnswer('{"light":"red","reason":"no_lockout","rep":0,"sure":true,"note":"x"}', true, REFEREE_REASONS)).toBeNull();
  });

  it('a red with a reason outside the list, or "none", or text that isn\'t JSON is unreadable', () => {
    expect(parseAnswer('{"light":"red","reason":"none","rep":0,"sure":true,"note":"x"}', false, REFEREE_REASONS)).toBeNull();
    expect(parseAnswer('{"light":"red","reason":"no_pause","rep":0,"sure":true,"note":"x"}', false, ['depth', 'no_lockout'])).toBeNull();
    expect(parseAnswer('White light.', false, REFEREE_REASONS)).toBeNull();
    expect(parseAnswer('{"light":"green","sure":true,"note":"x"}', false, REFEREE_REASONS)).toBeNull();
  });

  it('keeps the note to one line of 160 characters', () => {
    const a = parseAnswer(JSON.stringify({ light: 'white', reason: 'none', rep: 0, sure: true, note: `  ${'word '.repeat(60)}\n` }), false, REFEREE_REASONS)!;
    expect(a.note).toHaveLength(160);
    expect(a.note.endsWith('…')).toBe(true);
    expect(a.note).not.toMatch(/\n|  /);
  });
});

describe('the schema and the price', () => {
  it('the answer schema is closed and asks for every field', () => {
    expect(LAMP_SCHEMA.additionalProperties).toBe(false);
    expect([...LAMP_SCHEMA.required].sort()).toEqual(['light', 'note', 'reason', 'rep', 'sure']);
    expect(LAMP_SCHEMA.properties.reason.enum).toContain('none');
  });

  it('prices a call at Opus 5.5 rates: $4 in, $5 cache write, $0.20 cache read, $20 out, a million tokens', () => {
    expect(costOf({ input: 1_000_000, cache_write: 0, cache_read: 0, output: 0 })).toBe(4);
    expect(costOf({ input: 200, cache_write: 20_000, cache_read: 0, output: 1_500 })).toBeCloseTo(0.1308, 5);
    expect(costOf({ input: 200, cache_write: 0, cache_read: 20_000, output: 1_500 })).toBeCloseTo(0.0348, 5);
  });

  it('knows a spend-limit error when it sees one', () => {
    expect(isSpendLimit(new Error('Your credit balance is too low to access the Anthropic API.'))).toBe(true);
    expect(isSpendLimit(new Error('You have reached your specified API usage limits.'))).toBe(true);
    expect(isSpendLimit(new Error('Overloaded'))).toBe(false);
  });
});

describe('askLamps', () => {
  it('the left lamp goes first; head and right go out only once it has started', async () => {
    const order: string[] = [];
    let startLeft!: () => void;
    const leftGo = new Promise<void>(r => { startLeft = r; });
    const res = askLamps(async (lamp, t, onStart) => {
      order.push(`${lamp} asked`);
      if (lamp === 'left') { await leftGo; onStart?.(); order.push('left started'); }
      return sure(lamp, t);
    });
    await new Promise(r => setTimeout(r, 10));
    expect(order).toEqual(['left asked']);
    startLeft();
    const r = await res;
    expect(order.slice(0, 2)).toEqual(['left asked', 'left started']);
    expect(order).toContain('head asked');
    expect(order).toContain('right asked');
    expect(r).toMatchObject({ kind: 'lamps' });
    if (r.kind === 'lamps') expect(r.lamps.map(l => l.lamp)).toEqual(['left', 'head', 'right']);
  });

  it("a left lamp that fails before it streams still lets the others go", async () => {
    const r = await askLamps(async (lamp, t) => (lamp === 'left' ? error(lamp, t) : sure(lamp, t)));
    expect(r).toMatchObject({ kind: 'failed', spend: false });
    expect(r.calls.map(c => c.lamp)).toEqual(['left', 'left', 'head', 'right']);
  });

  it('a lamp not sure is asked once more; a sure second answer stands', async () => {
    const r = await askLamps(async (lamp, t) => (lamp === 'head' && t === 1 ? unsure(lamp, t) : sure(lamp, t, lamp === 'head' ? 'red' : 'white')));
    expect(r.kind).toBe('lamps');
    if (r.kind !== 'lamps') return;
    expect(r.lamps[1]).toMatchObject({ lamp: 'head', answer: { light: 'red', sure: true } });
    expect(r.lamps[1].calls).toHaveLength(2);
    expect(r.calls).toHaveLength(4);
  });

  it('not sure twice, or one unsure and one error, is white with the benefit of the doubt', async () => {
    const r = await askLamps(async (lamp, t) => (lamp === 'right' ? (t === 1 ? unsure(lamp, t) : error(lamp, t)) : unsure(lamp, t)));
    expect(r.kind).toBe('lamps');
    if (r.kind !== 'lamps') return;
    for (const l of r.lamps) expect(l.answer).toEqual({ light: 'white', reason: null, rep: null, sure: false, note: NOT_SURE_NOTE });
  });

  it('a spend-limit error stops that lamp at once and fails the whole try as spend', async () => {
    let rightAsks = 0;
    const r = await askLamps(async (lamp, t) => {
      if (lamp === 'right') { rightAsks++; return error(lamp, t, true); }
      return sure(lamp, t);
    });
    expect(rightAsks).toBe(1);
    expect(r).toMatchObject({ kind: 'failed', spend: true });
  });
});

describe("staging's test answers", () => {
  it('"Red, white, white" gives the left lamp a red with the lift\'s reason, and rep 1 at Home', () => {
    expect(fakeCall('red_white_white', 'left', 1, { redReason: 'no_pause', home: false })).toMatchObject({ answer: { light: 'red', reason: 'no_pause', rep: null } });
    expect(fakeCall('red_white_white', 'left', 1, { redReason: 'no_lockout', home: true })).toMatchObject({ answer: { rep: 1 } });
    expect(fakeCall('red_white_white', 'head', 1, { redReason: 'depth', home: false })).toMatchObject({ answer: { light: 'white', sure: true } });
  });

  it('each fake call is marked as a test in the log and costs nothing', () => {
    const o = fakeCall('errors_30m', 'head', 2, { redReason: 'depth', home: false });
    expect(o).toMatchObject({ kind: 'error', spend: false, call: { model: 'test:errors_30m', try: 2, cost_usd: 0 } });
  });
});
