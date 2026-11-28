// The referee bot's three lamps (plan 3.4d steps 3 and 4, item 103). The same frames and words
// go out three times, each ending with the lamp's line. The left lamp goes first, streamed, and
// writes the cache; head and right go out together on its first streamed event and read it.
// A lamp that isn't sure, can't be read or errors is asked once more; still not sure is white.
import Anthropic from '@anthropic-ai/sdk';
import type { RefereeCall } from '@/db/schema';
import { REFEREE_REASONS } from '@/lib/referee';

export const MODEL = 'claude-opus-5-5';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const CALL_TIMEOUT_MS = 120_000;
export const SDK_RETRIES = 2;
export const MAX_TOKENS = 16_000;
export const NOTE_MAX = 160;
export const NOT_SURE_NOTE = 'Not sure, so the benefit of the doubt.';
/** Opus 5.5, dollars a million tokens: in, 5-minute cache write, cache read, out (step 10). */
export const PRICE = { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 };

export type Lamp = 'left' | 'head' | 'right';
export const LAMPS: Lamp[] = ['left', 'head', 'right'];
export const LAMP_LINE: Record<Lamp, string> = {
  left: 'You are the left referee.',
  head: 'You are the head referee.',
  right: 'You are the right referee.',
};

export const LAMP_SCHEMA = {
  type: 'object',
  properties: {
    light: { type: 'string', enum: ['white', 'red'] },
    reason: { type: 'string', enum: [...REFEREE_REASONS, 'none'] },
    rep: { type: 'integer' },
    sure: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['light', 'reason', 'rep', 'sure', 'note'],
  additionalProperties: false,
} as const;

export type LampAnswer = { light: 'white' | 'red'; reason: string | null; rep: number | null; sure: boolean; note: string };

/** What one call came back as. `spend`: the API says the spend limit is reached (step 7). */
export type CallOutcome =
  | { kind: 'answer'; answer: LampAnswer; call: RefereeCall }
  | { kind: 'unsure'; why: string; call: RefereeCall }
  | { kind: 'error'; why: string; spend: boolean; call: RefereeCall };

export type Prefix = { system: string; content: Anthropic.Beta.BetaContentBlockParam[] };

/** Staging's "Referee bot test answers" (3.4d step 7): each fakes only what Anthropic sends back. */
export const TEST_ANSWERS = ['no_key', 'spend_limit', 'errors_30m', 'red_white_white', 'not_sure_twice', 'spot_weight_1'] as const;
export type TestAnswers = (typeof TEST_ANSWERS)[number];

export function parseAnswer(text: string, home: boolean, reasons: readonly string[]): LampAnswer | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  const o = raw as Record<string, unknown>;
  if (!o || (o.light !== 'white' && o.light !== 'red') || typeof o.sure !== 'boolean' || typeof o.note !== 'string') return null;
  const red = o.light === 'red';
  const reason = red ? String(o.reason) : null;
  if (red && !reasons.includes(reason!)) return null;
  const rep = red && home ? Number(o.rep) : null;
  if (red && home && !(Number.isInteger(rep) && rep! >= 1)) return null;
  const note = o.note.trim().replace(/\s+/g, ' ');
  return { light: o.light, reason, rep, sure: o.sure, note: note.length > NOTE_MAX ? `${note.slice(0, NOTE_MAX - 1)}…` : note };
}

export function costOf(u: { input: number; cache_write: number; cache_read: number; output: number }) {
  return +((u.input * PRICE.input + u.cache_write * PRICE.cacheWrite + u.cache_read * PRICE.cacheRead + u.output * PRICE.output) / 1e6).toFixed(5);
}

const blankCall = (lamp: RefereeCall['lamp'], attempt: number, ms: number, extra: Partial<RefereeCall> = {}): RefereeCall =>
  ({ lamp, try: attempt, model: null, stop: null, input: 0, cache_write: 0, cache_read: 0, output: 0, cost_usd: 0, ms, ...extra });

export const isSpendLimit = (e: unknown) => {
  const msg = `${(e as { message?: string })?.message ?? ''}`;
  return /credit balance|usage limit|spend limit|spending limit/i.test(msg);
};

/** One real call. `onStart` fires on the first streamed event: the cache entry can be read from then. */
export async function realCall(client: Anthropic, prefix: Prefix, lamp: Lamp, attempt: number, home: boolean, reasons: readonly string[],
  onStart?: () => void): Promise<CallOutcome> {
  const t0 = Date.now();
  let started = false;
  const start = () => { if (!started) { started = true; onStart?.(); } };
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: LAMP_SCHEMA as unknown as Record<string, unknown> } },
      system: prefix.system,
      messages: [{ role: 'user', content: [...prefix.content, { type: 'text', text: LAMP_LINE[lamp] }] }],
    }, { timeout: CALL_TIMEOUT_MS });
    for await (const event of stream) { void event; start(); }
    const m = await stream.finalMessage();
    const u = m.usage;
    const tokens = { input: u.input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0, cache_read: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 };
    const call: RefereeCall = { lamp, try: attempt, model: m.model, stop: m.stop_reason, ...tokens, cost_usd: costOf(tokens), ms: Date.now() - t0 };
    if (m.stop_reason === 'refusal') return { kind: 'unsure', why: 'refusal', call };
    const text = m.content.map(b => (b.type === 'text' ? b.text : '')).join('');
    const answer = parseAnswer(text, home, reasons);
    if (!answer) return { kind: 'unsure', why: `unreadable (${m.stop_reason})`, call };
    return { kind: 'answer', answer, call };
  } catch (e) {
    start();
    const why = `${(e as Error).name}: ${(e as Error).message}`.slice(0, 300);
    return { kind: 'error', why, spend: isSpendLimit(e), call: blankCall(lamp, attempt, Date.now() - t0, { error: why }) };
  }
}

/** What a test answer sends back instead of Anthropic. Null for "Real" (or no fake for this call). */
export function fakeCall(test: TestAnswers, lamp: Lamp, attempt: number, lift: { redReason: string; home: boolean }): CallOutcome {
  const call = blankCall(lamp, attempt, 0, { model: `test:${test}` });
  if (test === 'spend_limit') return { kind: 'error', why: 'test: spend limit reached', spend: true, call: { ...call, error: 'test: spend limit reached' } };
  if (test === 'errors_30m') return { kind: 'error', why: 'test: 500 from the API', spend: false, call: { ...call, error: 'test: 500 from the API' } };
  if (test === 'not_sure_twice') return { kind: 'answer', answer: { light: 'white', reason: null, rep: null, sure: false, note: 'Test answer: not sure.' }, call };
  if (test === 'red_white_white' && lamp === 'left') {
    return { kind: 'answer', answer: { light: 'red', reason: lift.redReason, rep: lift.home ? 1 : null, sure: true, note: 'Test answer: red.' }, call };
  }
  return { kind: 'answer', answer: { light: 'white', reason: null, rep: null, sure: true, note: 'Test answer: white.' }, call };
}

export type LampResult = { lamp: Lamp; answer: LampAnswer; calls: RefereeCall[] };
export type AllLamps =
  | { kind: 'lamps'; lamps: LampResult[]; calls: RefereeCall[] }
  | { kind: 'failed'; why: string; spend: boolean; calls: RefereeCall[] };

type Ask = (lamp: Lamp, attempt: number, onStart?: () => void) => Promise<CallOutcome>;

/**
 * One lamp, step 4: a sure answer stands; otherwise one fresh call; still not sure is white with
 * NOT_SURE_NOTE. Two errors (no answer at all) is a failed lamp: the job tries again later (step 7).
 */
async function oneLamp(ask: Ask, lamp: Lamp, onStart?: () => void): Promise<{ result?: LampResult; error?: { why: string; spend: boolean }; calls: RefereeCall[] }> {
  const calls: RefereeCall[] = [];
  let errors = 0;
  let last: { why: string; spend: boolean } = { why: '', spend: false };
  for (const attempt of [1, 2]) {
    const o = await ask(lamp, attempt, attempt === 1 ? onStart : undefined);
    calls.push(o.call);
    if (o.kind === 'answer' && o.answer.sure) return { result: { lamp, answer: o.answer, calls }, calls };
    if (o.kind === 'error') {
      errors++;
      last = { why: o.why, spend: o.spend };
      if (o.spend) return { error: last, calls };
    }
  }
  if (errors === 2) return { error: last, calls };
  return { result: { lamp, answer: { light: 'white', reason: null, rep: null, sure: false, note: NOT_SURE_NOTE }, calls }, calls };
}

/** The three lamps: left first, then head and right together on left's first streamed event. */
export async function askLamps(ask: Ask): Promise<AllLamps> {
  let release!: () => void;
  const leftStarted = new Promise<void>(r => { release = r; });
  const left = oneLamp(ask, 'left', release);
  // a left lamp that fails before streaming still releases, so the others aren't stuck
  const others = leftStarted.then(() => Promise.all([oneLamp(ask, 'head'), oneLamp(ask, 'right')]));
  const l = await left;
  release();
  const [h, r] = await others;
  const all = [l, h, r];
  const calls = all.flatMap(x => x.calls);
  const spend = all.find(x => x.error?.spend);
  if (spend) return { kind: 'failed', why: spend.error!.why, spend: true, calls };
  const failed = all.find(x => x.error);
  if (failed) return { kind: 'failed', why: failed.error!.why, spend: false, calls };
  return { kind: 'lamps', lamps: all.map(x => x.result!), calls };
}

export function lampAsker(o: { client: Anthropic | null; prefix: Prefix | null; test: TestAnswers | null; home: boolean; reasons: readonly string[]; redReason: string }): Ask {
  return (lamp, attempt, onStart) => {
    if (o.test) {
      onStart?.();
      return Promise.resolve(fakeCall(o.test, lamp, attempt, { redReason: o.redReason, home: o.home }));
    }
    return realCall(o.client!, o.prefix!, lamp, attempt, o.home, o.reasons, onStart);
  };
}
