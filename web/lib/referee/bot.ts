// The referee bot (plan 3.4d, item 88, with item 103's switch). Close calls and benches become
// `referee_jobs`; the dispatcher starts `referee_frames` for each; the worker here, in the web
// service, leases ready jobs (up to 4 at once) and asks Claude for three lamps; the lights land
// as a referee's do. When it can't run, the job is `doubt`: three whites, the benefit of the doubt.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, lifters, meets, opsSettings, refereeJobs, reviews, type Light, type RefereeCall, type RefereeFrame } from '@/db/schema';
import { judgeAttempt, type Frame, type MeetLift } from '@/lib/judge';
import { attemptReason, callOf } from '@/lib/lights';
import { benchByBar, judgedLift, logEvent, publish } from '@/lib/queue';
import { keys } from '@/lib/r2';
import { refereeReasons } from '@/lib/reason-words';
import { WHY } from '@/lib/referee';
import { divisionName, liftName, measuredLines, weightText } from '@/lib/referee-view';
import { PRODUCTION_SERVICE } from '@/lib/test-signin';
import { askLamps, lampAsker, SDK_RETRIES, CALL_TIMEOUT_MS, TEST_ANSWERS, type LampResult, type Prefix, type TestAnswers } from './lamps';

export const BOT_LOCK_KEY = 0x46_4d_52_42; // "FMRB"
export const WORKERS = 4;
export const LEASE_MS = 5 * 60_000;
export const FRAMES_RETRY_MS = 5 * 60_000;
export const FRAMES_TRIES = 2;
/** No frames run started at all this long after the job (no dispatcher): `no_frames`. */
export const FRAMES_NEVER_MS = 15 * 60_000;
export const API_FAILING_MS = 30 * 60_000;
export const TOO_SLOW_MS = 60 * 60_000;
export const RETRY_AFTER_MS = 60_000;
/** "Errors for 30 minutes": that job's clock runs 60 times faster (step 7). */
export const FAST_CLOCK = 60;
export const FRAME_CAP = 60;
export const TEST_ANSWERS_KEY = 'referee_test_answers';

export type DoubtReason = 'no_key' | 'spend_limit' | 'api_failing' | 'too_slow' | 'no_frames';

/** Item 103: off until the referee bot test (step 11) passes. */
export const botOn = (env: Record<string, string | undefined> = process.env) => env.REFEREE_BOT === 'on';
export const hasKey = (env: Record<string, string | undefined> = process.env) => !!env.ANTHROPIC_API_KEY;
/** Staging only, never production (step 7, as item 86's buttons). */
export const testAnswersAllowed = (env: Record<string, string | undefined> = process.env) =>
  env.STAGING_TEST_SIGNIN === 'on' && env.RENDER_SERVICE_NAME !== PRODUCTION_SERVICE;

export async function getSetting(db: Db, key: string) {
  const [r] = await db.select({ value: opsSettings.value }).from(opsSettings).where(eq(opsSettings.key, key));
  return r?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string | null) {
  if (value === null) { await db.delete(opsSettings).where(eq(opsSettings.key, key)); return; }
  await db.insert(opsSettings).values({ key, value }).onConflictDoUpdate({ target: opsSettings.key, set: { value, updatedAt: sql`now()` } });
}

/** The pending test answer for the next job, or null for "Real". Never on production. */
export async function pendingTestAnswers(db: Db, env: Record<string, string | undefined> = process.env): Promise<TestAnswers | null> {
  if (!testAnswersAllowed(env)) return null;
  const v = await getSetting(db, TEST_ANSWERS_KEY);
  return (TEST_ANSWERS as readonly string[]).includes(v ?? '') ? (v as TestAnswers) : null;
}

const fast = (test: string | null) => (test === 'errors_30m' ? FAST_CLOCK : 1);

/**
 * New jobs: every close call (benches included) with no lamps job yet. With the bot off, only the
 * one a test answer sends (item 103), and the test answer is then used up. No key: `doubt` at once.
 */
export async function enqueue(db: Db, env: Record<string, string | undefined> = process.env): Promise<string[]> {
  const on = botOn(env);
  const test = await pendingTestAnswers(db, env);
  if (!on && !test) return [];
  const rows = await db.execute<{ id: string }>(sql`
    select a.id from ${attempts} a join ${meets} m on m.id = a.meet_id
    where a.status = 'close_call' and m.kind <> 'sample'
      and not exists (select 1 from ${refereeJobs} j where j.attempt_id = a.id and j.kind = 'lamps')
    order by coalesce(a.judged_at, a.uploaded_at, a.created_at) asc
    limit ${on ? 20 : 1}`);
  const made: string[] = [];
  for (const [i, r] of rows.entries()) {
    const t = i === 0 ? test : null;
    if (t) await setSetting(db, TEST_ANSWERS_KEY, null);
    const [job] = await db.insert(refereeJobs).values({ kind: 'lamps', attemptId: r.id, testAnswers: t }).onConflictDoNothing().returning({ id: refereeJobs.id });
    if (!job) continue;
    made.push(job.id);
    await logEvent(db, 'referee_job', { job_id: job.id, test: t ?? undefined }, r.id);
    if (t === 'no_key' || (!hasKey(env) && !t)) await doubt(db, job.id, 'no_key');
  }
  return made;
}

/** The dispatcher's side: jobs whose `referee_frames` run should start now (first, or the one retry). */
export async function framesToStart(db: Db, limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await db.execute<{ id: string }>(sql`
    select id from ${refereeJobs}
    where status = 'waiting_frames' and (frames_started_at is null
      or (frames_tries < ${FRAMES_TRIES} and frames_started_at < now() - make_interval(secs => ${FRAMES_RETRY_MS / 1000})))
    order by created_at limit ${limit}`);
  return rows.map(r => r.id);
}

export async function framesStarted(db: Db, jobId: string) {
  await db.update(refereeJobs).set({ framesTries: sql`${refereeJobs.framesTries} + 1`, framesStartedAt: sql`now()` }).where(eq(refereeJobs.id, jobId));
}

/** The words for the phone's command keys, as burned into each frame ("after Press!"). */
export function commandList(ct: Record<string, number> | null): [number, string][] {
  if (!ct) return [];
  const word = (k: string) =>
    k === 'loaded' ? 'Bar is loaded.' : k === 'ready' ? 'Weights ready.' : k === 'squat' ? 'Squat!' : k === 'start' ? 'Start!'
      : k === 'rack' ? 'Rack!' : k === 'down' ? 'Down!' : /^press(_late)?(_\d+)?$/.test(k) ? 'Press!' : null;
  return Object.entries(ct).flatMap(([k, t]) => {
    const w = word(k);
    return w && typeof t === 'number' && Number.isFinite(t) ? [[Math.round(t), w] as [number, string]] : [];
  }).sort((a, b) => a[0] - b[0]);
}

export interface FrameStore {
  getJson<T>(key: string): Promise<T | null>;
  signedGet(key: string, seconds?: number): Promise<string>;
  signedPut(key: string, seconds?: number): Promise<string>;
  get(key: string): Promise<Response | null>;
}

/** POST /api/internal/referee-frames-job: what `referee_frames` needs for one job, or null. */
export async function framesJob(db: Db, store: FrameStore, jobId: string, env: Record<string, string | undefined> = process.env) {
  const [row] = await db.select({ j: refereeJobs, a: attempts }).from(refereeJobs).innerJoin(attempts, eq(attempts.id, refereeJobs.attemptId))
    .where(eq(refereeJobs.id, jobId));
  if (!row || row.j.status !== 'waiting_frames' || !row.a.videoKey) return null;
  const a = row.a;
  const ct = a.commandTimes as Record<string, number> | null;
  const moments: { ms: number; flagged: boolean }[] = [];
  let bench: { start_ms: number; press_ms: number; rack_ms: number | null } | null = null;
  if (benchByBar(a) && ct?.start !== undefined) {
    const press = ct.press ?? Object.entries(ct).find(([k]) => k.startsWith('press'))?.[1];
    if (press !== undefined) bench = { start_ms: ct.start, press_ms: press, rack_ms: ct.rack ?? null };
  } else if (a.posesKey) {
    const poses = await store.getJson<{ w: number; h: number; duration: number; frames: Frame[] }>(a.posesKey).catch(() => null);
    if (poses) {
      const v = judgeAttempt(poses.frames, poses, judgedLift(a) as MeetLift, ct as never, undefined, a.repsDeclared);
      for (const r of v.result?.reps ?? []) {
        const flagged = r.call.light !== 'white';
        for (const ms of [r.judgedFrameMs, r.endMs, (r as { pressMs?: number }).pressMs]) if (typeof ms === 'number') moments.push({ ms, flagged });
      }
    }
  }
  if (a.judgedFrameMs !== null) moments.push({ ms: a.judgedFrameMs, flagged: true });
  const upload_urls = await Promise.all(Array.from({ length: FRAME_CAP }, (_, n) => store.signedPut(keys.refereeFrame(a.id, n))));
  return {
    job_id: jobId, attempt_id: a.id, video_url: await store.signedGet(a.videoKey!),
    commands: commandList(ct), moments, bench, upload_urls,
    ...(env.FAULT === 'referee' ? { fault: true as const } : {}),
  };
}

export type FramesPost = { job_id: string; ok: boolean; frames?: { n: number; t_ms: number; sha256?: string }[]; error?: string; bench_poses?: boolean | null; secs?: number; commit?: string | null };

/** POST /api/internal/referee-frames: the frames are ready, or the run failed (a retry, then `no_frames`). */
export async function takeFrames(db: Db, p: FramesPost) {
  const [row] = await db.select({ j: refereeJobs }).from(refereeJobs).where(eq(refereeJobs.id, p.job_id));
  if (!row || !row.j.attemptId) return { status: 404 as const };
  if (row.j.status !== 'waiting_frames') return { status: 409 as const };
  const frames: RefereeFrame[] = p.ok ? (p.frames ?? []).filter(f => Number.isInteger(f.n) && f.n >= 0 && f.n < FRAME_CAP && Number.isFinite(f.t_ms))
    .map(f => ({ n: f.n, t_ms: Math.round(f.t_ms), key: keys.refereeFrame(row.j.attemptId!, f.n), ...(f.sha256 ? { sha256: String(f.sha256).slice(0, 64) } : {}) })) : [];
  await logEvent(db, 'referee_frames', { job_id: p.job_id, ok: p.ok && frames.length > 0, frames: frames.length, secs: p.secs ?? null, bench_poses: p.bench_poses ?? null, error: p.error?.slice(0, 300), commit: p.commit ?? null }, row.j.attemptId);
  if (p.ok && frames.length) {
    await db.update(refereeJobs).set({ status: 'ready', frames, framesReadyAt: sql`now()` })
      .where(and(eq(refereeJobs.id, p.job_id), eq(refereeJobs.status, 'waiting_frames')));
    return { status: 200 as const, ready: true };
  }
  await db.update(refereeJobs).set({ lastError: (p.error ?? 'no frames').slice(0, 300) }).where(eq(refereeJobs.id, p.job_id));
  if (row.j.framesTries >= FRAMES_TRIES) await doubt(db, p.job_id, 'no_frames');
  return { status: 200 as const, ready: false };
}

/** What it's told about this attempt (step 2): never her name. */
export function attemptWords(o: {
  lift: string; division: string; ageGroup: string | null; weight: number; units: string; repsDeclared: number | null;
  reason: string | null; measures: Record<string, unknown> | null; commandTimes: Record<string, unknown> | null; bench: boolean; frames: number;
}) {
  const lines = [
    `Lift: ${liftName(o.lift, o.division)}, ${divisionName(o.division)} division${o.ageGroup ? `, age group ${o.ageGroup}` : ''}.`,
    `Weight: ${weightText(o.weight, o.units, o.repsDeclared)}.`,
    ...(o.repsDeclared ? [`She declared ${o.repsDeclared} reps. Judge every rep; a red names the first red rep.`] : []),
    `Why it was sent: ${WHY[o.reason ?? ''] ?? WHY.judge_unavailable}.`,
    `The red-light reasons for this lift: ${refereeReasons(o.lift, o.division).join(', ')}.`,
  ];
  const measured = measuredLines(o.reason, o.measures, o.bench ? { commandTimes: o.commandTimes } : null);
  if (measured.length) lines.push('What the judge measured:', ...measured.map(l => `- ${l}`));
  lines.push(`${o.frames} frames follow, in time order.`);
  return lines.join('\n');
}

let promptText: string | null = null;
export function promptMd() {
  if (promptText === null) {
    const dir = process.cwd().endsWith(`${path.sep}web`) ? process.cwd() : path.join(process.cwd(), 'web');
    promptText = readFileSync(path.join(dir, 'lib', 'referee', 'prompt.md'), 'utf8');
  }
  return promptText;
}

/** The cached prefix (step 3): the words, the frames, and `cache_control` on the last block. */
export async function buildPrefix(store: Pick<FrameStore, 'get'>, words: string, frames: RefereeFrame[]): Promise<Prefix> {
  const images = await Promise.all(frames.map(async f => {
    const res = await store.get(f.key);
    if (!res) throw new Error(`frame ${f.n} missing`);
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  }));
  const content: Prefix['content'] = [
    { type: 'text', text: words },
    ...images.map(data => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data } })),
    { type: 'text', text: 'Give your light.', cache_control: { type: 'ephemeral' } },
  ];
  return { system: promptMd(), content };
}

type JobRow = typeof refereeJobs.$inferSelect;

async function setDoubt(db: Db, jobId: string, reason: DoubtReason, extra: { workerId?: string } = {}) {
  const [j] = await db.update(refereeJobs).set({ status: 'doubt', doubtReason: reason, decidedAt: sql`now()`, workerId: null, leaseUntil: null })
    .where(and(eq(refereeJobs.id, jobId), sql`${refereeJobs.status} in ('waiting_frames', 'ready', 'running')`,
      ...(extra.workerId ? [eq(refereeJobs.workerId, extra.workerId)] : [])))
    .returning();
  return j ?? null;
}

/** Step 7: `doubt` means three whites. The reason is `referee_unavailable`, not a red-light reason. */
export async function doubt(db: Db, jobId: string, reason: DoubtReason, workerId?: string) {
  const j = await setDoubt(db, jobId, reason, { workerId });
  if (!j?.attemptId) return false;
  await logEvent(db, 'referee_bot_doubt', { job_id: jobId, reason }, j.attemptId);
  console.log(JSON.stringify({ msg: 'referee bot doubt', job_id: jobId, reason }));
  await land(db, j, ['white', 'white', 'white'], [null, null, null], null, null, { referee_unavailable: true, referee_doubt: reason });
  return true;
}

/** The lights land as a referee's do (step 5), from the bot: `by_bot`, the lamp notes, no referee. */
async function land(db: Db, j: JobRow, lights: Light[], reasons: (string | null)[], rep: number | null, notes: (string | null)[] | null, extra: Record<string, unknown> = {}) {
  const attemptId = j.attemptId!;
  const call = callOf(lights);
  const anyRed = lights.includes('red');
  const reason = call === 'red' ? attemptReason(lights, reasons) : null;
  const unavailable = extra.referee_unavailable === true;
  const saved = await db.transaction(async tx => {
    const [a] = await tx.select({ reason: attempts.reason, lifterId: attempts.lifterId, judgedAt: attempts.judgedAt, repsDeclared: attempts.repsDeclared })
      .from(attempts).where(eq(attempts.id, attemptId));
    if (!a) return null;
    const home = !!a.repsDeclared;
    const measures = { referee: true, referee_bot: true, close_reason: a.reason, ...(anyRed ? { light_reasons: reasons } : {}), ...(home && anyRed && rep ? { red_rep: rep } : {}), ...extra };
    const [u] = await tx.update(attempts).set({
      status: 'judged', call, lights, reason, refereeId: null,
      measures: sql`coalesce(${attempts.measures}, '{}'::jsonb) || ${JSON.stringify(measures)}::jsonb`,
    }).where(and(eq(attempts.id, attemptId), eq(attempts.status, 'close_call'))).returning({ id: attempts.id });
    if (!u) return null;
    await tx.insert(reviews).values({
      attemptId, refereeId: null, lights, kind: 'close_call', byBot: true, lampNotes: notes,
      reason: unavailable ? 'referee_unavailable' : reason ?? attemptReason(lights, reasons),
    });
    return a;
  });
  if (!saved) return false;
  await logEvent(db, 'referee_saved', { call, bot: true, doubt: unavailable || undefined, waited_s: saved.judgedAt ? Math.round((Date.now() - new Date(saved.judgedAt).getTime()) / 1000) : null }, attemptId);
  await publish(db, { kind: 'attempt', attempt_id: attemptId, lifter_id: saved.lifterId, status: 'judged' });
  return true;
}

/** The housekeeping each tick: frames that never came, leases that ran out, jobs too slow or failing too long. */
export async function sweep(db: Db) {
  const noFrames = await db.execute<{ id: string }>(sql`
    select id from ${refereeJobs} where status = 'waiting_frames' and (
      (frames_tries >= ${FRAMES_TRIES} and frames_started_at < now() - make_interval(secs => ${FRAMES_RETRY_MS / 1000}))
      or (frames_tries = 0 and created_at < now() - make_interval(secs => ${FRAMES_NEVER_MS / 1000})))`);
  for (const r of noFrames) await doubt(db, r.id, 'no_frames');
  await db.execute(sql`
    update ${refereeJobs} set status = 'ready', worker_id = null, lease_until = null, tries = tries + 1
    where status = 'running' and lease_until < now()`);
  const slow = await db.execute<{ id: string }>(sql`
    select id from ${refereeJobs} where status in ('ready', 'running')
      and frames_ready_at < now() - make_interval(secs => ${TOO_SLOW_MS / 1000} / (case when test_answers = 'errors_30m' then ${FAST_CLOCK} else 1 end))`);
  for (const r of slow) await doubt(db, r.id, 'too_slow');
}

/** Lease up to `n` ready jobs for this worker (step 6), oldest frames first. */
export async function lease(db: Db, workerId: string, n: number): Promise<string[]> {
  if (n <= 0) return [];
  const rows = await db.execute<{ id: string }>(sql`
    update ${refereeJobs} set status = 'running', worker_id = ${workerId}, lease_until = now() + make_interval(secs => ${LEASE_MS / 1000})
    where id in (
      select id from ${refereeJobs} where status = 'ready' and (next_try_at is null or next_try_at <= now())
      order by frames_ready_at limit ${n} for update skip locked)
    returning id`);
  return rows.map(r => r.id);
}

export type JobDeps = { store: Pick<FrameStore, 'get'>; client: Anthropic | null; env?: Record<string, string | undefined>; now?: () => number };

/** One leased job: three lamps, then the lights land; or a try that failed, or `doubt`. */
export async function runJob(db: Db, jobId: string, workerId: string, deps: JobDeps) {
  const now = deps.now ?? Date.now;
  const [row] = await db.select({ j: refereeJobs, a: attempts, division: lifters.division, ageGroup: lifters.ageGroup, units: lifters.units })
    .from(refereeJobs).innerJoin(attempts, eq(attempts.id, refereeJobs.attemptId)).innerJoin(lifters, eq(lifters.id, attempts.lifterId))
    .where(and(eq(refereeJobs.id, jobId), eq(refereeJobs.workerId, workerId), eq(refereeJobs.status, 'running')));
  if (!row) return 'gone' as const;
  const { j, a } = row;
  const test = (TEST_ANSWERS as readonly string[]).includes(j.testAnswers ?? '') ? (j.testAnswers as TestAnswers) : null;
  if (a.status !== 'close_call') {
    // decided in /referee before the bot got to it
    await db.update(refereeJobs).set({ status: 'done', decidedAt: sql`now()`, workerId: null, leaseUntil: null }).where(eq(refereeJobs.id, jobId));
    return 'decided' as const;
  }
  if (!test && !deps.client) return (await doubt(db, jobId, 'no_key', workerId)) ? 'doubt' as const : 'gone' as const;
  const reasons = refereeReasons(a.lift, row.division);
  const home = !!a.repsDeclared;
  const redReason = a.lift === 'squat' ? 'depth' : benchByBar(a) ? 'no_pause' : 'no_lockout';
  const frames = (j.frames ?? []).slice().sort((x, y) => x.n - y.n);
  let prefix: Prefix | null = null;
  try {
    prefix = await buildPrefix(deps.store, attemptWords({
      lift: a.lift, division: row.division, ageGroup: row.ageGroup, weight: a.weight, units: row.units, repsDeclared: a.repsDeclared,
      reason: a.reason, measures: a.measures as Record<string, unknown> | null, commandTimes: a.commandTimes as Record<string, unknown> | null,
      bench: benchByBar(a), frames: frames.length,
    }), frames);
  } catch (e) {
    return failTry(db, j, workerId, `frames: ${(e as Error).message}`.slice(0, 300), [], now);
  }
  const t0 = now();
  const out = await askLamps(lampAsker({ client: deps.client, prefix, test, home, reasons, redReason }));
  const cost = out.calls.reduce((s, c) => s + c.cost_usd, 0);
  await db.update(refereeJobs).set({
    calls: sql`${refereeJobs.calls} || ${JSON.stringify(out.calls)}::jsonb`, costUsd: sql`${refereeJobs.costUsd} + ${cost}`,
  }).where(eq(refereeJobs.id, jobId));
  if (out.kind === 'failed') {
    if (out.spend) return (await doubt(db, jobId, 'spend_limit', workerId)) ? 'doubt' as const : 'gone' as const;
    return failTry(db, j, workerId, out.why, out.calls, now);
  }
  return finish(db, j, workerId, out.lamps, home, now() - t0);
}

async function failTry(db: Db, j: JobRow, workerId: string, why: string, _calls: RefereeCall[], now: () => number) {
  const k = fast(j.testAnswers);
  const first = j.firstErrorAt ? new Date(j.firstErrorAt).getTime() : now();
  console.log(JSON.stringify({ msg: 'referee bot try failed', job_id: j.id, error: why }));
  if (now() - first >= API_FAILING_MS / k) return (await doubt(db, j.id, 'api_failing', workerId)) ? 'doubt' as const : 'gone' as const;
  await db.update(refereeJobs).set({
    status: 'ready', workerId: null, leaseUntil: null, tries: sql`${refereeJobs.tries} + 1`, lastError: why,
    firstErrorAt: new Date(first), nextTryAt: new Date(now() + RETRY_AFTER_MS / k),
  }).where(and(eq(refereeJobs.id, j.id), eq(refereeJobs.workerId, workerId), eq(refereeJobs.status, 'running')));
  return 'retry' as const;
}

async function finish(db: Db, j: JobRow, workerId: string, lamps: LampResult[], home: boolean, ms: number) {
  const lights = lamps.map(l => l.answer.light) as Light[];
  const reasons = lamps.map(l => (l.answer.light === 'red' ? l.answer.reason : null));
  const firstRed = lamps.find(l => l.answer.light === 'red');
  const rep = home && firstRed ? firstRed.answer.rep : null;
  const answers = lamps.map(l => ({ lamp: l.lamp, ...l.answer }));
  const [done] = await db.update(refereeJobs).set({ status: 'done', answers, decidedAt: sql`now()`, workerId: null, leaseUntil: null })
    .where(and(eq(refereeJobs.id, j.id), eq(refereeJobs.workerId, workerId), eq(refereeJobs.status, 'running'))).returning();
  if (!done) return 'gone' as const;
  await logEvent(db, 'referee_bot_lights', { job_id: j.id, lights, ms, sure: lamps.filter(l => l.answer.sure).length }, j.attemptId);
  await land(db, done, lights, reasons, rep, lamps.map(l => l.answer.note));
  return 'done' as const;
}

/** Why the bot isn't running, for /ops's red line (2.4), or null. */
export async function notRunning(db: Db, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  if ((botOn(env) || testAnswersAllowed(env)) && !hasKey(env)) return 'no key';
  const [r] = await db.execute<{ reason: string }>(sql`
    select doubt_reason as reason from ${refereeJobs}
    where status = 'doubt' and doubt_reason in ('spend_limit', 'api_failing', 'too_slow', 'no_frames') and decided_at > now() - interval '30 minutes'
    order by decided_at desc limit 1`);
  const words: Record<string, string> = { spend_limit: 'spend limit reached', api_failing: 'the API is failing', too_slow: 'too slow', no_frames: "the frames couldn't be made" };
  return r ? words[r.reason] ?? r.reason : null;
}

/** /ops: what the bot cost this month (step 10). */
export async function costThisMonth(db: Db) {
  const [r] = await db.execute<{ usd: number | null; jobs: number }>(sql`
    select sum(cost_usd)::float as usd, count(*)::int as jobs from ${refereeJobs}
    where created_at >= date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York'`);
  return { usd: Number(r?.usd ?? 0), jobs: Number(r?.jobs ?? 0) };
}

export function makeClient(env: Record<string, string | undefined> = process.env) {
  return env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: SDK_RETRIES, timeout: CALL_TIMEOUT_MS }) : null;
}

/** One tick of the worker: new jobs, housekeeping, and leases for the free slots. Jobs run in the background. */
export async function botTick(db: Db, deps: JobDeps & { workerId: string; running: Set<string> }) {
  const env = deps.env ?? process.env;
  await db.transaction(async tx => {
    const [{ locked }] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(${BOT_LOCK_KEY}) as locked`);
    if (!locked) return;
    const txDb = tx as unknown as Db;
    await enqueue(txDb, env);
    await sweep(txDb);
  });
  const ids = await lease(db, deps.workerId, WORKERS - deps.running.size);
  return ids.map(id => {
    deps.running.add(id);
    return runJob(db, id, deps.workerId, deps)
      .catch(e => { console.log(JSON.stringify({ msg: 'referee bot job error', job_id: id, error: (e as Error).message })); return 'error' as const; })
      .finally(() => deps.running.delete(id));
  });
}

let timer: ReturnType<typeof setInterval> | null = null;

/** The worker's 2-second loop, once per process (instrumentation-node). */
export function startRefereeBot(db: Db, store: Pick<FrameStore, 'get'>, everyMs = 2000) {
  if (timer) return;
  const workerId = `bot-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const running = new Set<string>();
  let busy = false;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await botTick(db, { workerId, running, store, client: makeClient() });
    } catch (e) {
      console.log(JSON.stringify({ msg: 'referee bot tick error', error: (e as Error).message }));
    } finally {
      busy = false;
    }
  }, everyMs);
  timer.unref?.();
}

export function stopRefereeBot() {
  if (timer) clearInterval(timer);
  timer = null;
}
