// The referee bot (plan 3.4d, item 88, with item 103's switch). Close calls and benches become
// `referee_jobs`; the dispatcher starts `referee_frames` for each; the worker here, in the web
// service, leases ready jobs (up to 4 at once) and asks Claude for three lamps; the lights land
// as a referee's do. When it can't run, the job is `doubt`: three whites, the benefit of the doubt.
import { botOn } from '@/lib/referee/words';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, lifters, meets, opsSettings, refereeJobs, reviews, type Light, type RefereeCall, type RefereeFrame } from '@/db/schema';
import { BAR_RULES, judgeAttempt, type Frame, type MeetLift } from '@/lib/judge';
import type { BarPoint } from '@/lib/judge/bar-measure';
import { attemptReason, callOf } from '@/lib/lights';
import { benchByBar, judgedLift, logEvent, publish } from '@/lib/queue';
import { clipAfterLights } from '@/lib/card/clip-job';
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
export { botOn };
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
 * A test answer goes to the next close call or bench (3.4d step 14): the first to come in once it
 * was set, never one already waiting from before (on staging, old close calls wait for the test referee).
 */
export async function enqueue(db: Db, env: Record<string, string | undefined> = process.env): Promise<string[]> {
  const on = botOn(env);
  const test = await pendingTestAnswers(db, env);
  if (!on && !test) return [];
  // a test answer's time: only a close call that came in once it was set takes it
  const since = sql`(select s.updated_at from ${opsSettings} s where s.key = ${TEST_ANSWERS_KEY})`;
  const came = sql`coalesce(a.judged_at, a.uploaded_at, a.created_at)`;
  const rows = await db.execute<{ id: string; after: boolean }>(sql`
    select a.id, coalesce(${came} >= ${since}, false) as after
    from ${attempts} a join ${meets} m on m.id = a.meet_id
    where a.status = 'close_call' and m.kind <> 'sample'
      and not exists (select 1 from ${refereeJobs} j where j.attempt_id = a.id and j.kind = 'lamps')
      ${on ? sql`` : sql`and ${came} >= ${since}`}
    order by ${came} asc
    limit ${on ? 20 : 1}`);
  const made: string[] = [];
  let used = !test;
  for (const r of rows) {
    const t = !used && r.after ? test : null;
    if (t) { used = true; await setSetting(db, TEST_ANSWERS_KEY, null); }
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

/** A saved path point as the worker reads it for the frames: [t ms, y (fraction of the frame, down), confidence]. */
export type PathPoint = [number, number, number];
export type BenchBlock = { start_ms: number; press_ms: number | null; rack_ms: number | null; path?: PathPoint[] };

/**
 * The bench's frames (step 1): "Start!", "Press!" (on time, or late: `press_late`) and "Rack!" in ms, or null with no
 * Start!. Only number-valued keys count: `press_late_why` ("lost", "still") is a word, not a time. With no Press! (the
 * bar never stopped), `press_ms` is null. `path` is the saved bar path (`attempts.barKey`), on every bench that has
 * one: the worker finds the touch and lockout from it first (worker/bench_path.py), the wrists only standing in.
 */
export function benchBlock(ct: Record<string, unknown> | null, bar?: { path: BarPoint[] } | null): BenchBlock | null {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const start = num(ct?.start);
  if (start === undefined) return null;
  const press = num(ct?.press) ?? num(ct?.press_late) ?? null;
  const out: BenchBlock = { start_ms: start, press_ms: press, rack_ms: num(ct?.rack) ?? null };
  if (bar?.path?.length) out.path = bar.path.map(([t, , y, score]) => [Math.round(t), +y.toFixed(4), +score.toFixed(3)]);
  return out;
}

/** A path point counts for the frames at this score or more (worker/bench_path.py's PATH_SCORE). */
export const FRAMES_PATH_SCORE = 0.5;

/**
 * The path the frames are found on (3.4d step 1, item 110): the phone's own, and where it's lost, the server's track
 * for the frames only. "Lost" is any stretch of `gapMs` (the bar's 500 ms no-frame rule) or more with no phone point
 * that counts, before its first or after its last included; the server's points in it stand in, its own guard's stuck
 * stretches already at score 0. Every phone point that counts is kept as it is.
 */
export function framesPath(phone: BarPoint[], server: BarPoint[] | null | undefined, gapMs = BAR_RULES.noFrameMs): BarPoint[] {
  if (!server?.length) return phone;
  const ok = (p: BarPoint) => p[3] >= FRAMES_PATH_SCORE;
  const seen = phone.filter(ok).map(p => p[0]).sort((a, b) => a - b);
  const holes: [number, number][] = [];
  if (!seen.length) holes.push([-Infinity, Infinity]);
  else {
    if (seen[0] >= gapMs) holes.push([-Infinity, seen[0]]);
    for (let i = 1; i < seen.length; i++) if (seen[i] - seen[i - 1] >= gapMs) holes.push([seen[i - 1], seen[i]]);
    holes.push([seen[seen.length - 1], Infinity]);
  }
  const inHole = (t: number) => holes.some(([a, b]) => t > a && t < b);
  return [...phone.filter(p => ok(p) || !inHole(p[0])), ...server.filter(p => inHole(p[0]))].sort((a, b) => a[0] - b[0]);
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
  let bar: { path: BarPoint[] } | null = null;
  if (benchByBar(a) && a.barKey) bar = await store.getJson<{ path: BarPoint[] }>(a.barKey).catch(() => null);
  // item 110: the server's track stands in where the phone's path is lost, for the frames only
  if (bar?.path && a.barServerKey && a.barServerKey !== a.barKey) {
    const server = await store.getJson<{ path: BarPoint[] }>(a.barServerKey).catch(() => null);
    bar = { path: framesPath(bar.path, server?.path) };
  }
  const bench = benchByBar(a) ? benchBlock(ct, bar) : null;
  if (!benchByBar(a) && a.posesKey) {
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

export type FramesPost = { job_id: string; ok: boolean; frames?: { n: number; t_ms: number; sha256?: string }[]; error?: string; bench_way?: 'path' | 'partway' | 'wrists' | 'window' | null; secs?: number; commit?: string | null };

/** POST /api/internal/referee-frames: the frames are ready, or the run failed (a retry, then `no_frames`). */
export async function takeFrames(db: Db, p: FramesPost) {
  const [row] = await db.select({ j: refereeJobs }).from(refereeJobs).where(eq(refereeJobs.id, p.job_id));
  if (!row || !row.j.attemptId) return { status: 404 as const };
  if (row.j.status !== 'waiting_frames') return { status: 409 as const };
  const frames: RefereeFrame[] = p.ok ? (p.frames ?? []).filter(f => Number.isInteger(f.n) && f.n >= 0 && f.n < FRAME_CAP && Number.isFinite(f.t_ms))
    .map(f => ({ n: f.n, t_ms: Math.round(f.t_ms), key: keys.refereeFrame(row.j.attemptId!, f.n), ...(f.sha256 ? { sha256: String(f.sha256).slice(0, 64) } : {}) })) : [];
  await logEvent(db, 'referee_frames', { job_id: p.job_id, ok: p.ok && frames.length > 0, frames: frames.length, secs: p.secs ?? null, bench_way: p.bench_way ?? null, error: p.error?.slice(0, 300), commit: p.commit ?? null }, row.j.attemptId);
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
  // the bot's lights can give her a total or a bomb-out, as a referee's do: her clip is queued then (3.9 step 6)
  await clipAfterLights(db, attemptId);
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

export const NOT_RUNNING_WORDS: Record<DoubtReason, string> = {
  no_key: 'no key', spend_limit: 'spend limit reached', api_failing: 'the API is failing', too_slow: 'too slow', no_frames: "the frames couldn't be made",
};
/** A doubt this recent still says why on /ops (and to the uptime check). */
export const NOT_RUNNING_WINDOW_MIN = 30;

/**
 * Why the bot isn't running, for /ops's red line (2.4), or null: on with no key, or a job in `doubt`
 * in the last 30 minutes (on staging that's also a test answer's doubt). Off with nothing wrong: null.
 */
export async function notRunning(db: Db, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  if (botOn(env) && !hasKey(env)) return NOT_RUNNING_WORDS.no_key;
  const [r] = await db.execute<{ reason: DoubtReason }>(sql`
    select doubt_reason as reason from ${refereeJobs}
    where status = 'doubt' and decided_at > now() - make_interval(mins => ${NOT_RUNNING_WINDOW_MIN})
    order by decided_at desc limit 1`);
  return r ? NOT_RUNNING_WORDS[r.reason] ?? r.reason : null;
}

/**
 * For the uptime check (2.4: an issue after 10 minutes of the red line): why the bot isn't running
 * and for how long. On with no key has no start, so it counts as long ago. Null: it's running, or off.
 */
export async function botWatch(db: Db, env: Record<string, string | undefined> = process.env): Promise<{ reason: string; forS: number } | null> {
  const reason = await notRunning(db, env);
  if (!reason) return null;
  if (botOn(env) && !hasKey(env)) return { reason, forS: Number.MAX_SAFE_INTEGER };
  // the red line has shown since the first doubt of this run of them (each keeps it up 30 minutes)
  const [r] = await db.execute<{ s: number }>(sql`
    with d as (select decided_at, lag(decided_at) over (order by decided_at) as prev from ${refereeJobs}
               where status = 'doubt' and decided_at > now() - interval '1 day')
    select extract(epoch from now() - max(decided_at))::int as s from d
    where prev is null or decided_at - prev > make_interval(mins => ${NOT_RUNNING_WINDOW_MIN})`);
  return { reason, forS: Number(r?.s ?? 0) };
}

/** What /ops shows of the bot: the switch, the red line, the queue, its speed, and the month's cost. */
export async function botOps(db: Db, env: Record<string, string | undefined> = process.env) {
  const [q] = await db.execute<{ waiting: number; median_s: number | null; done_hour: number }>(sql`
    select (select count(*)::int from ${refereeJobs} where status in ('waiting_frames', 'ready', 'running')) as waiting,
      (select percentile_cont(0.5) within group (order by extract(epoch from decided_at - frames_ready_at))::float
         from ${refereeJobs} where status = 'done' and decided_at > now() - interval '1 hour' and frames_ready_at is not null) as median_s,
      (select count(*)::int from ${refereeJobs} where status in ('done', 'doubt') and decided_at > now() - interval '1 hour') as done_hour`);
  return {
    on: botOn(env),
    key: hasKey(env),
    notRunning: await notRunning(db, env),
    waiting: Number(q?.waiting ?? 0),
    medianS: q?.median_s ?? null,
    decidedHour: Number(q?.done_hour ?? 0),
    cost: await costThisMonth(db),
    spendLimitUsd: Number(env.REFEREE_SPEND_LIMIT_USD ?? 100),
    testAnswersAllowed: testAnswersAllowed(env),
    testAnswers: testAnswersAllowed(env) ? await pendingTestAnswers(db, env) : null,
  };
}
export type BotOps = Awaited<ReturnType<typeof botOps>>;

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
