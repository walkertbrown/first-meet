// Spot checks (plan 3.4d step 8, 5.33, 5.35's gate, items 104 and 105). Once a meet's clip deadline
// has passed, each lifter in the top 3 of each group (division × age group) gets a spot check: a row
// in `spot_checks`, and with the referee bot on a `spot_check` job. The top 3 is worked out again on
// every tick, so a lifter who moves in gets her own. The bot makes one call over a frame or two from
// each of her clips; a sure "weight not visible" or "arms bent" makes that attempt red. A person on
// `/referee/spot` stands over the bot, and "Checked" puts a spot-check red back.
import Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import {
  attempts, lifters, meets, refereeJobs, reviews, spotChecks,
  type Light, type RefereeCall, type SpotFinding, type SpotProblem,
} from '@/db/schema';
import { boardRows, type BoardLifter } from '@/lib/board';
import { meetLifters } from '@/lib/host-data';
import { callOf } from '@/lib/lights';
import { ORDER, meetTotal } from '@/lib/meet';
import { asMeetAttempt } from '@/lib/meet-flow';
import { pastDeadline } from '@/lib/meet-window';
import { logEvent, publish } from '@/lib/queue';
import { clipAfterLights } from '@/lib/card/clip-job';
import { botOn } from '@/lib/referee/words';
import { divisionName, liftName, weightText } from '@/lib/referee-view';
import { liftWord } from '@/lib/stage/meet-words';
import { CALL_TIMEOUT_MS, FALLBACK_BETA, MAX_TOKENS, MODEL, NOTE_MAX, costOf, isSpendLimit, type Prefix } from './lamps';

/** Staging's test answer for the next spot-check job (3.4d step 7, item 104). */
export const SPOT_TEST = 'spot_weight_1';
/** Two frames a clip, nine clips. */
export const SPOT_FRAME_CAP = 18;

// ---------- who is checked ----------

/** Each group's top 3, by the board's order (3.8's ties): the lifters a spot check covers. */
export function topThree(list: BoardLifter[]): string[] {
  const out: string[] = [];
  for (const d of ['barbell', 'home'] as const) {
    const taken = new Map<string, number>();
    for (const r of boardRows(list, d, true)) {
      const n = taken.get(r.ageGroup) ?? 0;
      if (n < 3) { out.push(r.id); taken.set(r.ageGroup, n + 1); }
    }
  }
  return out;
}

type MeetForSpot = { id: string; kind: string; status: string; closesAt: Date | null; clipDeadlineAt: Date | null; opensAt?: Date | null };

/** The spot checks run on a real or test meet past its clip deadline, until the board is final. */
export const spotTime = (m: MeetForSpot, now = new Date()) =>
  (m.kind === 'real' || m.kind === 'test') && m.status !== 'final' && pastDeadline(m as never, now);

/**
 * New spot checks for whoever is now in a top 3 and has none (item 104). With the bot on, each gets a
 * job; with it off, only the one a test answer sends (the test answer is then used up). No key and
 * no test answer: `doubt` at once, which counts as checked.
 */
export async function syncSpotChecks(db: Db, m: MeetForSpot, deps: {
  env?: Record<string, string | undefined>; now?: Date;
  test?: () => Promise<boolean>; useTest?: () => Promise<void>; doubt?: (db: Db, jobId: string) => Promise<unknown>; hasKey?: boolean;
} = {}): Promise<string[]> {
  const env = deps.env ?? process.env;
  if (!spotTime(m, deps.now)) return [];
  const list = await meetLifters(db, m.id);
  const top = topThree(list);
  if (!top.length) return [];
  const had = new Set((await db.select({ id: spotChecks.lifterId }).from(spotChecks).where(eq(spotChecks.meetId, m.id))).map(r => r.id));
  const made: string[] = [];
  for (const lifterId of top) {
    if (had.has(lifterId)) continue;
    const [row] = await db.insert(spotChecks).values({ meetId: m.id, lifterId }).onConflictDoNothing().returning({ id: spotChecks.id });
    if (!row) continue;
    made.push(lifterId);
    const test = deps.test ? await deps.test() : false;
    if (!botOn(env) && !test) continue;
    if (test) await deps.useTest?.();
    const [job] = await db.insert(refereeJobs).values({ kind: 'spot_check', lifterId, testAnswers: test ? SPOT_TEST : null }).returning({ id: refereeJobs.id });
    await db.update(spotChecks).set({ jobId: job.id }).where(eq(spotChecks.id, row.id));
    await logEvent(db, 'referee_job', { job_id: job.id, kind: 'spot_check', lifter_id: lifterId, test: test ? SPOT_TEST : undefined });
    if (!test && !(deps.hasKey ?? !!env.ANTHROPIC_API_KEY)) await deps.doubt?.(db, job.id);
  }
  return made;
}

/** 5.35's gate: every lifter now in a top 3 has a finished spot check (the bot's, a doubt, or a person's). */
export async function spotChecksDone(db: Db, meetId: string): Promise<{ done: boolean; waiting: number }> {
  const top = topThree(await meetLifters(db, meetId));
  if (!top.length) return { done: true, waiting: 0 };
  const rows = await db.select({ lifterId: spotChecks.lifterId, bot: spotChecks.bot, person: spotChecks.person })
    .from(spotChecks).where(and(eq(spotChecks.meetId, meetId), inArray(spotChecks.lifterId, top)));
  const finished = new Set(rows.filter(r => r.person || r.bot).map(r => r.lifterId));
  const waiting = top.filter(id => !finished.has(id)).length;
  return { done: waiting === 0, waiting };
}

// ---------- what the bot is sent ----------

export type SpotClip = { attempt_id: string; n: number; label: string; video_url: string; start_ms: number | null; weight_ms: number | null };

/** The moment of "Start!" in a clip: the lift's first command after the set-up ("Squat!" on the Barbell squat). */
export function startMs(ct: Record<string, number> | null): number | null {
  if (!ct) return null;
  for (const k of ['start', 'squat', 'ready', 'loaded']) if (typeof ct[k] === 'number' && Number.isFinite(ct[k])) return Math.round(ct[k]);
  return null;
}

/** Her attempts with a clip, in the meet's order, numbered 1 to 9 as the bot is told them. */
export async function spotAttempts(db: Db, lifterId: string) {
  const rows = await db.select().from(attempts).where(eq(attempts.lifterId, lifterId));
  const order = (a: { lift: string; number: number }) => ORDER.findIndex(s => s.lift === a.lift && s.number === a.number);
  return rows.filter(a => a.videoKey && a.status === 'judged').sort((a, b) => order(a) - order(b)).map(a => ({ ...a, n: order(a) + 1 }));
}

export const attemptLabel = (a: { lift: string; number: number; weight: number; repsDeclared: number | null }, division: string, units: string) =>
  `${liftName(a.lift, division)} ${a.number} · ${weightText(a.weight, units, a.repsDeclared)}`;

export function spotWords(o: { division: string; ageGroup: string | null; clips: { n: number; label: string; press: boolean }[]; frames: number }) {
  return [
    `${divisionName(o.division)} division${o.ageGroup ? `, age group ${o.ageGroup}` : ''}. Her attempts, one clip each:`,
    ...o.clips.map(c => `- Attempt ${c.n}: ${c.label}${c.press ? ' (the overhead press: also say whether the arms were bent at the top)' : ''}`),
    `${o.frames} frames follow. Each is stamped at the top left with its attempt and its moment.`,
  ].join('\n');
}

// ---------- the call ----------

export const SPOT_SCHEMA = {
  type: 'object',
  properties: {
    attempts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          attempt: { type: 'integer' },
          weight_visible: { type: 'boolean' },
          weight_sure: { type: 'boolean' },
          arms_bent: { type: 'boolean' },
          arms_sure: { type: 'boolean' },
        },
        required: ['attempt', 'weight_visible', 'weight_sure', 'arms_bent', 'arms_sure'],
        additionalProperties: false,
      },
    },
    same_lifter: { type: 'string', enum: ['true', 'false', 'not_sure'] },
    same_lifter_sure: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['attempts', 'same_lifter', 'same_lifter_sure', 'note'],
  additionalProperties: false,
} as const;

export type SpotAnswer = {
  attempts: { attempt: number; weight_visible: boolean; weight_sure: boolean; arms_bent: boolean; arms_sure: boolean }[];
  same_lifter: 'true' | 'false' | 'not_sure'; same_lifter_sure: boolean; note: string;
};

export function parseSpot(text: string): SpotAnswer | null {
  let o: Record<string, unknown>;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || !Array.isArray(o.attempts) || !['true', 'false', 'not_sure'].includes(String(o.same_lifter)) || typeof o.note !== 'string') return null;
  const list = (o.attempts as Record<string, unknown>[]).filter(a => a && Number.isInteger(a.attempt) && typeof a.weight_visible === 'boolean')
    .map(a => ({ attempt: Number(a.attempt), weight_visible: !!a.weight_visible, weight_sure: a.weight_sure === true, arms_bent: a.arms_bent === true, arms_sure: a.arms_sure === true }));
  const note = o.note.trim().replace(/\s+/g, ' ');
  return { attempts: list, same_lifter: o.same_lifter as SpotAnswer['same_lifter'], same_lifter_sure: o.same_lifter_sure === true,
    note: note.length > NOTE_MAX ? `${note.slice(0, NOTE_MAX - 1)}…` : note };
}

/** The bot's answer as a finding. Only sure answers count; not sure is "Checked". Arms count only on the Home press. */
export function spotFinding(ans: SpotAnswer, byN: Map<number, { id: string; press: boolean }>): SpotFinding {
  const problems: SpotProblem[] = [];
  for (const a of ans.attempts) {
    const at = byN.get(a.attempt);
    if (!at) continue;
    if (!a.weight_visible && a.weight_sure) problems.push({ kind: 'weight_not_visible', attemptId: at.id });
    else if (at.press && a.arms_bent && a.arms_sure) problems.push({ kind: 'arms_bent', attemptId: at.id });
  }
  if (ans.same_lifter === 'false' && ans.same_lifter_sure) problems.push({ kind: 'not_same_lifter' });
  return { outcome: problems.length ? 'problem' : 'checked', problems };
}

export type SpotOutcome =
  | { kind: 'answer'; answer: SpotAnswer; call: RefereeCall }
  | { kind: 'unsure'; why: string; call: RefereeCall }
  | { kind: 'error'; why: string; spend: boolean; call: RefereeCall };

const blank = (attempt: number, ms: number, extra: Partial<RefereeCall> = {}): RefereeCall =>
  ({ lamp: 'spot', try: attempt, model: null, stop: null, input: 0, cache_write: 0, cache_read: 0, output: 0, cost_usd: 0, ms, ...extra });

export async function realSpotCall(client: Anthropic, prefix: Prefix, attempt: number): Promise<SpotOutcome> {
  const t0 = Date.now();
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SPOT_SCHEMA as unknown as Record<string, unknown> } },
      system: prefix.system,
      messages: [{ role: 'user', content: prefix.content }],
    }, { timeout: CALL_TIMEOUT_MS });
    const m = await stream.finalMessage();
    const u = m.usage;
    const tokens = { input: u.input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0, cache_read: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 };
    const call: RefereeCall = { lamp: 'spot', try: attempt, model: m.model, stop: m.stop_reason, ...tokens, cost_usd: costOf(tokens), ms: Date.now() - t0 };
    if (m.stop_reason === 'refusal') return { kind: 'unsure', why: 'refusal', call };
    const answer = parseSpot(m.content.map(b => (b.type === 'text' ? b.text : '')).join(''));
    return answer ? { kind: 'answer', answer, call } : { kind: 'unsure', why: `unreadable (${m.stop_reason})`, call };
  } catch (e) {
    const why = `${(e as Error).name}: ${(e as Error).message}`.slice(0, 300);
    return { kind: 'error', why, spend: isSpendLimit(e), call: blank(attempt, Date.now() - t0, { error: why }) };
  }
}

/** "Spot check: weight not visible on attempt 1": only what Anthropic sends back is faked. */
export function fakeSpotCall(ns: number[], attempt: number): SpotOutcome {
  return {
    kind: 'answer', call: blank(attempt, 0, { model: `test:${SPOT_TEST}` }),
    answer: {
      attempts: ns.map(n => ({ attempt: n, weight_visible: n !== 1, weight_sure: true, arms_bent: false, arms_sure: true })),
      same_lifter: 'true', same_lifter_sure: true, note: 'Test answer: weight not visible on attempt 1.',
    },
  };
}

/** One call; unreadable or an error gets one fresh call. Unreadable twice is "Checked"; errors twice is a failed try. */
export async function askSpot(ask: (attempt: number) => Promise<SpotOutcome>):
  Promise<{ kind: 'answer'; answer: SpotAnswer | null; calls: RefereeCall[] } | { kind: 'failed'; why: string; spend: boolean; calls: RefereeCall[] }> {
  const calls: RefereeCall[] = [];
  let errors = 0;
  let last = { why: '', spend: false };
  for (const attempt of [1, 2]) {
    const o = await ask(attempt);
    calls.push(o.call);
    if (o.kind === 'answer') return { kind: 'answer', answer: o.answer, calls };
    if (o.kind === 'error') {
      errors++;
      last = { why: o.why, spend: o.spend };
      if (o.spend) return { kind: 'failed', ...last, calls };
    }
  }
  if (errors === 2) return { kind: 'failed', ...last, calls };
  return { kind: 'answer', answer: null, calls };
}

// ---------- the lights it changes ----------

export type SpotMark = {
  /** The lights before the spot check, put back by a person's "Checked". */
  before: { call: 'white' | 'red' | 'close' | null; lights: Light[] | null; reason: string | null };
  reason: 'weight_not_shown' | 'no_lockout';
  by: 'bot' | 'referee';
  at: string;
  /** A person's "Checked" put it back. */
  undone?: string;
};

const problemReason = (k: SpotProblem['kind']) => (k === 'arms_bent' ? 'no_lockout' : 'weight_not_shown') as SpotMark['reason'];

/**
 * Makes the finding's reds, and puts back any earlier spot-check red it no longer names (a person
 * standing over the bot). An attempt that was already red stays as it was. Returns the attempts changed.
 */
export async function applyFinding(db: Db, lifterId: string, f: SpotFinding, by: 'bot' | 'referee', refereeId: string | null = null, now = new Date()) {
  const want = new Map<string, SpotMark['reason']>();
  for (const p of f.problems) if (p.kind !== 'not_same_lifter') want.set(p.attemptId, problemReason(p.kind));
  const mine = await db.select().from(attempts).where(eq(attempts.lifterId, lifterId));
  const changed: { id: string; to: 'red' | 'back' }[] = [];
  for (const a of mine) {
    const mark = (a.measures as { spot_check?: SpotMark } | null)?.spot_check;
    const active = mark && !mark.undone;
    const reason = want.get(a.id);
    if (reason && !active && a.call !== 'red') {
      const m: SpotMark = { before: { call: a.call, lights: a.lights, reason: a.reason }, reason, by, at: now.toISOString() };
      const lights: Light[] = ['red', 'red', 'red'];
      await db.transaction(async tx => {
        await tx.update(attempts).set({ call: 'red', lights, reason, spotChecked: true,
          measures: sql`coalesce(${attempts.measures}, '{}'::jsonb) || ${JSON.stringify({ spot_check: m })}::jsonb` }).where(eq(attempts.id, a.id));
        await tx.insert(reviews).values({ attemptId: a.id, refereeId, lights, reason, kind: 'spot_check', byBot: by === 'bot' });
      });
      changed.push({ id: a.id, to: 'red' });
    } else if (!reason && active) {
      const back = mark.before;
      const lights = back.lights ?? null;
      await db.transaction(async tx => {
        await tx.update(attempts).set({ call: back.call ?? (lights ? callOf(lights) : 'white'), lights, reason: back.reason,
          measures: sql`coalesce(${attempts.measures}, '{}'::jsonb) || ${JSON.stringify({ spot_check: { ...mark, undone: now.toISOString() } })}::jsonb` })
          .where(eq(attempts.id, a.id));
        await tx.insert(reviews).values({ attemptId: a.id, refereeId, lights, reason: back.reason, kind: 'spot_check', byBot: by === 'bot' });
      });
      changed.push({ id: a.id, to: 'back' });
    }
  }
  if (mine.length) await db.update(attempts).set({ spotChecked: true }).where(eq(attempts.lifterId, lifterId));
  for (const c of changed) {
    await logEvent(db, 'spot_check_lights', { to: c.to, by }, c.id);
    await publish(db, { kind: 'attempt', attempt_id: c.id, lifter_id: lifterId, status: 'judged' });
  }
  // her best lift's clip follows her total, as after any lights (3.9 step 6)
  if (changed.length) await clipAfterLights(db, changed[0].id);
  return changed;
}

/** The bot's finding lands (or its doubt). A person who already decided stands: the bot's is kept, and changes nothing. */
export async function landSpot(db: Db, jobId: string, f: SpotFinding) {
  const [row] = await db.select().from(spotChecks).where(eq(spotChecks.jobId, jobId));
  if (!row) return false;
  await db.update(spotChecks).set({ bot: f, decidedAt: row.decidedAt ?? new Date() }).where(eq(spotChecks.id, row.id));
  if (!row.person && f.outcome === 'problem') await applyFinding(db, row.lifterId, f, 'bot');
  else if (!row.person) await db.update(attempts).set({ spotChecked: true }).where(eq(attempts.lifterId, row.lifterId));
  await logEvent(db, 'spot_check_bot', { job_id: jobId, outcome: f.outcome, problems: f.problems.map(p => p.kind) });
  return true;
}

/** A person's "Checked" or "Problem" on `/referee/spot` (5.33). Refused once the board is final. */
export async function decideSpot(db: Db, lifterId: string, refereeId: string | null, f: SpotFinding, now = new Date()): Promise<'ok' | 'final' | 'gone'> {
  const [row] = await db.select({ s: spotChecks, status: meets.status }).from(spotChecks).innerJoin(meets, eq(meets.id, spotChecks.meetId))
    .where(eq(spotChecks.lifterId, lifterId));
  if (!row) return 'gone';
  if (row.status === 'final') return 'final';
  await db.update(spotChecks).set({ person: f, refereeId, decidedAt: now }).where(eq(spotChecks.id, row.s.id));
  await applyFinding(db, lifterId, f, 'referee', refereeId, now);
  await logEvent(db, 'spot_check_person', { lifter_id: lifterId, outcome: f.outcome, problems: f.problems.map(p => p.kind) });
  return 'ok';
}

// ---------- what the pages say ----------

/** The Small line above the buttons on `/referee/spot` (5.33), from the bot's side. */
export function botLine(o: { bot: SpotFinding | null; job: { status: string } | null; botOn: boolean }, labelOf: (attemptId: string) => string): string {
  if (o.bot?.outcome === 'doubt') return "The referee bot couldn't check this one, so it counts as checked.";
  if (o.bot) {
    const p = o.bot.problems[0];
    if (!p) return 'Checked by the referee bot.';
    if (p.kind === 'weight_not_visible') return `Referee bot: weight not visible on ${labelOf(p.attemptId)}.`;
    if (p.kind === 'arms_bent') return `Referee bot: arms bent on ${labelOf(p.attemptId)}.`;
    return 'Referee bot: this may not be the same lifter. An admin has been told.';
  }
  if (o.job && o.job.status !== 'done' && o.job.status !== 'doubt') return 'The referee bot is checking.';
  return o.botOn ? 'The referee bot is checking.' : 'Waiting for a referee.';
}

/** 5.31's line for a spot-checked lifter: none for a doubt nobody checked. */
export function resultsLine(s: { bot: SpotFinding | null; person: SpotFinding | null } | null | undefined): string | null {
  if (!s) return null;
  if (s.person) return 'Checked by a referee';
  if (s.bot && s.bot.outcome !== 'doubt') return 'Checked by the referee bot';
  return null;
}

/** Her total page's line (3.4d step 8), for the spot-check red that changed her total. */
export const totalLine = (liftWord: string, n: number) => `A spot check found a problem with your ${liftWord} ${n}, so your total changed.`;

/** Admin-only on /ops: a sure "not the same lifter" (3.4d step 8), with nothing automatic. */
export async function notSameLifter(db: Db, meetId?: string) {
  const rows = await db.select({ name: lifters.cardName, id: lifters.id, bot: spotChecks.bot, person: spotChecks.person, meetId: spotChecks.meetId })
    .from(spotChecks).innerJoin(lifters, eq(lifters.id, spotChecks.lifterId))
    .where(meetId ? eq(spotChecks.meetId, meetId) : undefined);
  const says = (f: SpotFinding | null) => !!f?.problems.some(p => p.kind === 'not_same_lifter');
  return rows.filter(r => says(r.person) || (!r.person && says(r.bot))).map(r => ({ id: r.id, name: r.name }));
}

export type SpotBanner = { id: string; key: string; text: string; call: 'white' | 'red'; lights: ('white' | 'red')[]; after: string | null };

/**
 * 5.27's banner for a spot check: "<Lift> <n> · <weight> · **No lift** · Spot check", or "**Good lift**"
 * once a person put it back. The key changes with the undo, so she sees that one too.
 */
export function spotBanners(rows: { id: string; lift: string; number: number; weight: number; repsDeclared: number | null; call: string | null; lights: Light[] | null; measures: unknown }[],
  l: { division: 'barbell' | 'home'; units: string }): SpotBanner[] {
  const out: SpotBanner[] = [];
  for (const a of rows) {
    const mark = (a.measures as { spot_check?: SpotMark } | null)?.spot_check;
    if (!mark || (a.call !== 'red' && a.call !== 'white')) continue;
    const what = l.division === 'home' && a.repsDeclared ? `${a.repsDeclared} reps` : `${a.weight} ${l.units}`;
    const lights = (a.lights && a.lights.length === 3 ? a.lights : [a.call, a.call, a.call]) as ('white' | 'red')[];
    out.push({
      id: a.id, key: `${a.id}:${mark.undone ?? mark.at}`, text: `${liftWord(a.lift, l.division)} ${a.number} · ${what} · `,
      call: a.call, lights, after: mark.undone ? null : ' · Spot check',
    });
  }
  return out;
}

/**
 * Her total page's Small (3.4d step 8): only when a spot-check red changed her total, for the first
 * such attempt in the meet's order. Her total with the lights from before the spot check is compared.
 */
export async function spotChangedLine(db: Db, l: { id: string; division: 'barbell' | 'home'; homeWeights: unknown }): Promise<string | null> {
  const rows = await db.select().from(attempts).where(and(eq(attempts.lifterId, l.id), sql`${attempts.measures} ? 'spot_check'`));
  const marked = rows.filter(a => { const m = (a.measures as { spot_check?: SpotMark }).spot_check; return a.call === 'red' && m && !m.undone; });
  if (!marked.length) return null;
  const all = await db.select().from(attempts).where(eq(attempts.lifterId, l.id));
  const now = all.map(a => asMeetAttempt(a, l as never));
  const before = now.map(a => {
    const m = marked.find(x => x.id === a.id);
    return m ? { ...a, call: (m.measures as { spot_check: SpotMark }).spot_check.before.call } : a;
  });
  const t = (list: typeof now) => { const x = meetTotal(list, l.division, true); return x.kind === 'total' ? `t${x.value}` : x.kind; };
  if (t(now) === t(before)) return null;
  const order = (a: { lift: string; number: number }) => ORDER.findIndex(s => s.lift === a.lift && s.number === a.number);
  const first = marked.sort((a, b) => order(a) - order(b))[0];
  return totalLine(liftWord(first.lift, l.division), first.number);
}
