// The referee bot's jobs on Postgres (plan 3.4d, item 88; item 103's switch): queued from close
// calls and benches, frames from `referee_frames`, three lamps, the lights landing, and `doubt`.
// Anthropic is faked by staging's test answers (step 7), which fake only what comes back from it.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, opsSettings, refereeJobs, reviews } from '../../web/db/schema';
import { keys } from '../../web/lib/r2';
import {
  botOps, botWatch, costThisMonth, doubt, enqueue, framesJob, framesStarted, framesToStart, lease, notRunning, runJob, setSetting, sweep, takeFrames,
  TEST_ANSWERS_KEY, type FrameStore,
} from '../../web/lib/referee/bot';
import { NOT_SURE_NOTE } from '../../web/lib/referee/lamps';
import { botQueue, botQueueLine, botSide } from '../../web/lib/referee/bot-view';
import { changeLights } from '../../web/lib/referee';
import { lifters, meets } from '../../web/db/schema';
import { freshDb, MemStore, seed, URL_ } from './setup';

class FramesStore extends MemStore implements FrameStore {
  async signedPut(key: string) { return `https://r2.test/${key}?put`; }
  async get(key: string) { return this.objects.has(key) ? new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])) : null; }
}

const STAGING = { STAGING_TEST_SIGNIN: 'on', RENDER_SERVICE_NAME: 'first-meet-web-staging' };
const PRODUCTION = { STAGING_TEST_SIGNIN: 'on', RENDER_SERVICE_NAME: 'first-meet-web' };
const SQUAT_CT = { loaded: 200, squat: 1500, rack: 6000 };
const BENCH_CT = { loaded: 200, start: 1000, press: 3000, rack: 5000 };

describe.skipIf(!URL_)('the referee bot', () => {
  let db: Db, drop: () => Promise<void>;
  const store = new FramesStore();
  beforeAll(async () => { ({ db, drop } = await freshDb(6)); });
  afterAll(async () => drop?.());
  beforeEach(async () => {
    // each test starts with no close call waiting and no test answer set
    await db.execute(sql`update attempts set status = 'judged' where status = 'close_call'`);
    await db.execute(sql`update referee_jobs set status = 'done' where status not in ('done', 'doubt')`);
    await db.delete(opsSettings);
  });

  async function closeCall(lift: 'squat' | 'bench' = 'squat', reason = lift === 'bench' ? 'bench_referee' : 'borderline_depth') {
    const { attempts: [id] } = await seed(db, store, 1, lift);
    await db.update(attempts).set({
      status: 'close_call', reason, judgedAt: sql`now()`, judgedFrameMs: 3000,
      commandTimes: lift === 'bench' ? BENCH_CT : SQUAT_CT, measures: lift === 'bench' ? { pause_s: 0.4 } : { depth: 0.01 },
    }).where(eq(attempts.id, id));
    return id;
  }

  /** The job for an attempt through `referee_frames` to `ready`, with three frames in R2. */
  async function ready(attemptId: string) {
    const [j] = await db.select().from(refereeJobs).where(eq(refereeJobs.attemptId, attemptId));
    await framesStarted(db, j.id);
    for (const n of [0, 1, 2]) store.objects.set(keys.refereeFrame(attemptId, n), 'jpeg');
    const r = await takeFrames(db, { job_id: j.id, ok: true, frames: [0, 1, 2].map(n => ({ n, t_ms: 1500 + n * 500, sha256: 'ab'.repeat(32) })) });
    expect(r).toMatchObject({ status: 200, ready: true });
    return j.id;
  }

  async function run(jobId: string, now?: () => number) {
    const ids = await lease(db, 'bot-test', 4);
    expect(ids).toContain(jobId);
    return runJob(db, jobId, 'bot-test', { store, client: null, env: STAGING, now });
  }

  const job = async (id: string) => (await db.select().from(refereeJobs).where(eq(refereeJobs.id, id)))[0];
  const attempt = async (id: string) => (await db.select().from(attempts).where(eq(attempts.id, id)))[0];

  it('item 103: with REFEREE_BOT off and no test answer, close calls wait in /referee: no job', async () => {
    await closeCall();
    expect(await enqueue(db, { ...STAGING, ANTHROPIC_API_KEY: 'k' })).toEqual([]);
  });

  it('a test answer goes to the next close call to come in, never one already waiting for the test referee', async () => {
    const old = await closeCall();
    await setSetting(db, TEST_ANSWERS_KEY, 'red_white_white');
    expect(await enqueue(db, STAGING)).toEqual([]);
    const next = await closeCall('bench');
    const [id] = await enqueue(db, STAGING);
    expect(await job(id)).toMatchObject({ attemptId: next, testAnswers: 'red_white_white' });
    expect((await db.select().from(refereeJobs).where(eq(refereeJobs.attemptId, old)))).toHaveLength(0);
    // with the bot on, the old one gets a job too, but the test answer stays with the next one
    await setSetting(db, TEST_ANSWERS_KEY, 'no_key');
    const later = await closeCall();
    const both = await enqueue(db, { ...STAGING, REFEREE_BOT: 'on', ANTHROPIC_API_KEY: 'k' });
    expect(both).toHaveLength(2);
    expect((await db.select().from(refereeJobs).where(eq(refereeJobs.attemptId, old)))[0]).toMatchObject({ testAnswers: null });
    expect((await db.select().from(refereeJobs).where(eq(refereeJobs.attemptId, later)))[0]).toMatchObject({ testAnswers: 'no_key', status: 'doubt' });
  });

  it("production never takes a test answer, even one written in the table", async () => {
    await closeCall();
    await setSetting(db, TEST_ANSWERS_KEY, 'red_white_white');
    expect(await enqueue(db, PRODUCTION)).toEqual([]);
  });

  it('a test answer sends the next close call to the bot, for that one job, and is then used up', async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'red_white_white');
    const a1 = await closeCall();
    const a2 = await closeCall();
    const made = await enqueue(db, STAGING);
    expect(made).toHaveLength(1);
    expect(await job(made[0])).toMatchObject({ attemptId: a1, status: 'waiting_frames', testAnswers: 'red_white_white' });
    expect(await enqueue(db, STAGING)).toEqual([]);
    expect((await db.select().from(refereeJobs).where(eq(refereeJobs.attemptId, a2)))).toHaveLength(0);
  });

  it('with REFEREE_BOT on, every close call and bench gets a job; with no key each is doubt at once: three whites', async () => {
    const sq = await closeCall();
    const be = await closeCall('bench');
    const made = await enqueue(db, { REFEREE_BOT: 'on' });
    expect(made).toHaveLength(2);
    for (const id of [sq, be]) {
      const a = await attempt(id);
      expect(a).toMatchObject({ status: 'judged', call: 'white', lights: ['white', 'white', 'white'], reason: null });
      expect(a.measures).toMatchObject({ referee: true, referee_bot: true, referee_unavailable: true, referee_doubt: 'no_key' });
      const [r] = await db.select().from(reviews).where(eq(reviews.attemptId, id));
      expect(r).toMatchObject({ byBot: true, reason: 'referee_unavailable', refereeId: null, kind: 'close_call' });
    }
    expect(await notRunning(db, { REFEREE_BOT: 'on' })).toBe('no key');
    // those doubts still say why for 30 minutes, whatever the switch
    expect(await notRunning(db, { REFEREE_BOT: 'off' })).toBe('no key');
  });

  it('off, with no doubt in the last 30 minutes, the bot is just off: no red line', async () => {
    await db.update(refereeJobs).set({ decidedAt: sql`now() - interval '31 minutes'` }).where(eq(refereeJobs.status, 'doubt'));
    expect(await notRunning(db, { REFEREE_BOT: 'off' })).toBeNull();
    expect(await notRunning(db, STAGING)).toBeNull();
    expect(await notRunning(db, { REFEREE_BOT: 'on' })).toBe('no key');
  });

  it('"No key" on staging: that bench gets three whites, and /ops says the bot is not running while the key is missing', async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'no_key');
    const be = await closeCall('bench');
    const [id] = await enqueue(db, { ...STAGING, ANTHROPIC_API_KEY: 'k' });
    expect(await job(id)).toMatchObject({ status: 'doubt', doubtReason: 'no_key' });
    expect(await attempt(be)).toMatchObject({ status: 'judged', call: 'white', lights: ['white', 'white', 'white'] });
    expect(await notRunning(db, STAGING)).toBe('no key');
    expect((await botOps(db, STAGING)).notRunning).toBe('no key');
  });

  it('the frames job: the clip, the commands as spoken, 60 places to put frames, and the bench\'s times', async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'red_white_white');
    const be = await closeCall('bench');
    const [id] = await enqueue(db, STAGING);
    expect(await framesToStart(db, 5)).toEqual([id]);
    const j = await framesJob(db, store, id, {});
    expect(j).toMatchObject({
      job_id: id, attempt_id: be, video_url: expect.stringContaining('?signed'),
      commands: [[200, 'Bar is loaded.'], [1000, 'Start!'], [3000, 'Press!'], [5000, 'Rack!']],
      bench: { start_ms: 1000, press_ms: 3000, rack_ms: 5000 }, moments: [{ ms: 3000, flagged: true }],
    });
    expect(j!.upload_urls).toHaveLength(60);
    expect(j!.upload_urls[7]).toContain(`referee/${be}/7.jpg`);
    expect(j).not.toHaveProperty('fault');
    expect(await framesJob(db, store, id, { FAULT: 'referee' })).toMatchObject({ fault: true });
    // started once: not again until 5 minutes have passed
    await framesStarted(db, id);
    expect(await framesToStart(db, 5)).toEqual([]);
  });

  it('the frames job sends the saved bar path on a bench, with no Press! too', async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'red_white_white');
    const be = await closeCall('bench');
    const path = Array.from({ length: 90 }, (_, i) => {
      const t = Math.round(i * 1000 / 15);
      return [t, 0.5, t <= 1000 ? 0.3 : t <= 2500 ? 0.3 + 0.3 * (t - 1000) / 1500 : Math.max(0.3, 0.6 - 0.3 * (t - 2500) / 1500), 0.9];
    });
    await store.putJson(keys.bar(be), { w: 1280, h: 720, duration: 6, tap: null, path });
    await db.update(attempts).set({ commandTimes: { loaded: 200, start: 1000, rack: 5000 }, barKey: keys.bar(be) }).where(eq(attempts.id, be));
    const [id] = await enqueue(db, STAGING);
    const j = await framesJob(db, store, id, {});
    expect(j!.commands).toEqual([[200, 'Bar is loaded.'], [1000, 'Start!'], [5000, 'Rack!']]);
    expect(j!.bench).toMatchObject({ start_ms: 1000, press_ms: null, rack_ms: 5000 });
    expect(j!.bench!.path).toHaveLength(90);
    expect(j!.bench!.path![30]).toEqual([2000, 0.5, 0.9]);
  });

  it('frames that fail get one more run after 5 minutes, then the job is doubt "no_frames"', async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'red_white_white');
    const sq = await closeCall();
    const [id] = await enqueue(db, STAGING);
    await framesStarted(db, id);
    expect(await takeFrames(db, { job_id: id, ok: false, error: 'RuntimeError: FAULT=referee set' })).toMatchObject({ ready: false });
    expect(await job(id)).toMatchObject({ status: 'waiting_frames', lastError: 'RuntimeError: FAULT=referee set' });
    await db.update(refereeJobs).set({ framesStartedAt: sql`now() - interval '6 minutes'` }).where(eq(refereeJobs.id, id));
    expect(await framesToStart(db, 5)).toEqual([id]);
    await framesStarted(db, id);
    await takeFrames(db, { job_id: id, ok: false, error: 'again' });
    expect(await job(id)).toMatchObject({ status: 'doubt', doubtReason: 'no_frames' });
    expect(await attempt(sq)).toMatchObject({ status: 'judged', call: 'white' });
  });

  it('"Red, white, white": three lamps, a 2–1 good lift, each lamp\'s note stored, shown on 5.33 not on her attempt', async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'red_white_white');
    const sq = await closeCall();
    const [id] = await enqueue(db, STAGING);
    await ready(sq);
    expect(await run(id)).toBe('done');
    const j = await job(id);
    expect(j).toMatchObject({ status: 'done' });
    expect(j.calls.map(c => c.lamp).sort()).toEqual(['head', 'left', 'right']);
    expect(j.answers).toEqual([
      expect.objectContaining({ lamp: 'left', light: 'red', reason: 'depth', sure: true }),
      expect.objectContaining({ lamp: 'head', light: 'white' }),
      expect.objectContaining({ lamp: 'right', light: 'white' }),
    ]);
    const a = await attempt(sq);
    expect(a).toMatchObject({ status: 'judged', call: 'white', lights: ['red', 'white', 'white'], reason: null, refereeId: null });
    expect(a.measures).toMatchObject({ referee_bot: true, light_reasons: ['depth', null, null] });
    const [r] = await db.select().from(reviews).where(eq(reviews.attemptId, sq));
    expect(r).toMatchObject({ byBot: true, lights: ['red', 'white', 'white'], lampNotes: ['Test answer: red.', 'Test answer: white.', 'Test answer: white.'] });
  });

  it('"Not sure, twice": each lamp is asked once more, then white with "Not sure, so the benefit of the doubt."', async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'not_sure_twice');
    const sq = await closeCall();
    const [id] = await enqueue(db, STAGING);
    await ready(sq);
    expect(await run(id)).toBe('done');
    const j = await job(id);
    expect(j.calls).toHaveLength(6);
    expect(j.calls.filter(c => c.try === 2)).toHaveLength(3);
    const [r] = await db.select().from(reviews).where(eq(reviews.attemptId, sq));
    expect(r.lampNotes).toEqual([NOT_SURE_NOTE, NOT_SURE_NOTE, NOT_SURE_NOTE]);
    expect(await attempt(sq)).toMatchObject({ call: 'white', lights: ['white', 'white', 'white'] });
  });

  it('"Spend limit reached": doubt at once, three whites, and /ops says why', async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'spend_limit');
    const sq = await closeCall();
    const [id] = await enqueue(db, STAGING);
    await ready(sq);
    expect(await run(id)).toBe('doubt');
    expect(await job(id)).toMatchObject({ status: 'doubt', doubtReason: 'spend_limit' });
    expect(await attempt(sq)).toMatchObject({ call: 'white', lights: ['white', 'white', 'white'] });
    expect(await notRunning(db, { ...STAGING, ANTHROPIC_API_KEY: 'k' })).toBe('spend limit reached');
  });

  it('"Errors for 30 minutes" (its clock 60 times faster): tries again after each failure, then doubt "api_failing"', async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'errors_30m');
    const sq = await closeCall();
    const [id] = await enqueue(db, STAGING);
    await ready(sq);
    const t0 = Date.now();
    expect(await run(id, () => t0)).toBe('retry');
    const j = await job(id);
    expect(j).toMatchObject({ status: 'ready', tries: 1, lastError: 'test: 500 from the API' });
    expect(new Date(j.nextTryAt!).getTime() - t0).toBe(1000);   // a minute, at 60 times
    expect(await lease(db, 'bot-test', 4)).toEqual([]);           // not before then
    await db.update(refereeJobs).set({ nextTryAt: null }).where(eq(refereeJobs.id, id));
    expect(await run(id, () => t0 + 31_000)).toBe('doubt');     // 30 minutes, at 60 times
    expect(await job(id)).toMatchObject({ status: 'doubt', doubtReason: 'api_failing' });
    expect(await attempt(sq)).toMatchObject({ call: 'white' });
  });

  it('a lease that runs out goes back to ready (tries counts it); a job 60 minutes past its frames is doubt "too_slow"', async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'red_white_white');
    const sq = await closeCall();
    const [id] = await enqueue(db, STAGING);
    await ready(sq);
    await lease(db, 'gone-worker', 4);
    await db.update(refereeJobs).set({ leaseUntil: sql`now() - interval '1 second'` }).where(eq(refereeJobs.id, id));
    await sweep(db);
    expect(await job(id)).toMatchObject({ status: 'ready', tries: 1, workerId: null });
    await db.update(refereeJobs).set({ framesReadyAt: sql`now() - interval '61 minutes'` }).where(eq(refereeJobs.id, id));
    await sweep(db);
    expect(await job(id)).toMatchObject({ status: 'doubt', doubtReason: 'too_slow' });
    expect(await attempt(sq)).toMatchObject({ call: 'white' });
  });

  it('a close call a person decided in /referee first: the job is done and lands nothing', async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'red_white_white');
    const sq = await closeCall();
    const [id] = await enqueue(db, STAGING);
    await ready(sq);
    await db.update(attempts).set({ status: 'judged', call: 'red', lights: ['red', 'red', 'red'] }).where(eq(attempts.id, sq));
    expect(await run(id)).toBe('decided');
    expect(await attempt(sq)).toMatchObject({ lights: ['red', 'red', 'red'] });
    expect(await db.select().from(reviews).where(eq(reviews.attemptId, sq))).toHaveLength(0);
  });

  it('a doubt never overrides lights that already landed', async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'red_white_white');
    const sq = await closeCall();
    const [id] = await enqueue(db, STAGING);
    await ready(sq);
    await run(id);
    expect(await doubt(db, id, 'too_slow')).toBe(false);
    expect(await attempt(sq)).toMatchObject({ lights: ['red', 'white', 'white'] });
  });

  it("/ops's cost this month adds every job's calls", async () => {
    const before = await costThisMonth(db);
    await setSetting(db, TEST_ANSWERS_KEY, 'red_white_white');
    const sq = await closeCall();
    const [id] = await enqueue(db, STAGING);
    await db.update(refereeJobs).set({ costUsd: 0.25 }).where(eq(refereeJobs.id, id));
    void sq;
    const after = await costThisMonth(db);
    expect(after.usd - before.usd).toBeCloseTo(0.25, 5);
    expect(after.jobs - before.jobs).toBe(1);
  });

  it("/ops's numbers: the switch, what waits, the median from frames ready to lights, and the test answer set", async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'red_white_white');
    const sq = await closeCall();
    const [id] = await enqueue(db, STAGING);
    await ready(sq);
    await run(id);
    // every job decided this hour took 90 s from its frames
    await db.update(refereeJobs).set({ framesReadyAt: sql`decided_at - interval '90 seconds'` }).where(eq(refereeJobs.status, 'done'));
    await setSetting(db, TEST_ANSWERS_KEY, 'not_sure_twice');
    const b = await botOps(db, STAGING);
    expect(b).toMatchObject({ on: false, key: false, waiting: 0, testAnswersAllowed: true, testAnswers: 'not_sure_twice', spendLimitUsd: 100 });
    expect(b.medianS).toBeCloseTo(90, 0);
    expect(b.decidedHour).toBeGreaterThan(0);
    const p = await botOps(db, PRODUCTION);
    expect(p).toMatchObject({ testAnswersAllowed: false, testAnswers: null });
  });

  it('the uptime check: how long the red line has shown, from the first doubt of this run of them', async () => {
    await db.update(refereeJobs).set({ decidedAt: sql`now() - interval '2 days'` }).where(eq(refereeJobs.status, 'doubt'));
    expect(await botWatch(db, {})).toBeNull();
    await setSetting(db, TEST_ANSWERS_KEY, 'no_key');
    await closeCall();
    const [j1] = await enqueue(db, STAGING);
    await setSetting(db, TEST_ANSWERS_KEY, 'no_key');
    await closeCall();
    const [j2] = await enqueue(db, STAGING);
    await db.update(refereeJobs).set({ decidedAt: sql`now() - interval '25 minutes'` }).where(eq(refereeJobs.id, j1));
    await db.update(refereeJobs).set({ decidedAt: sql`now() - interval '5 minutes'` }).where(eq(refereeJobs.id, j2));
    const w = await botWatch(db, {});
    expect(w?.reason).toBe('no key');
    expect(w!.forS).toBeGreaterThanOrEqual(25 * 60 - 2);
    expect((await botWatch(db, { REFEREE_BOT: 'on' }))!.forS).toBe(Number.MAX_SAFE_INTEGER);
  });

  // ---------- 5.33 and 5.36 from item 88: the bot's side, and "Change the lights" ----------

  /** A close call in a real meet, through the bot with "red, white, white". */
  async function botDecided(meetStatus: 'open' | 'final' = 'open') {
    await setSetting(db, TEST_ANSWERS_KEY, 'red_white_white');
    const sq = await closeCall();
    const a = await attempt(sq);
    await db.update(meets).set({ kind: 'real', status: meetStatus }).where(eq(meets.id, a.meetId));
    const [id] = await enqueue(db, STAGING);
    await ready(sq);
    expect(await run(id)).toBe('done');
    return sq;
  }
  const referee = async () => (await db.insert(lifters).values({ cardName: 'Ref', isReferee: true }).returning())[0].id;

  it('5.33 queue: deciding rows first, oldest first, then decided ones newest first, with the lights; demo never', async () => {
    const decided = await botDecided();
    const waiting = await closeCall();
    await db.update(meets).set({ kind: 'real' }).where(eq(meets.id, (await attempt(waiting)).meetId));
    const demo = await closeCall();
    const q = await botQueue(db);
    const ids = q.rows.map(r => r.attemptId);
    expect(ids).toContain(decided);
    expect(ids).not.toContain(demo);
    expect(ids.indexOf(waiting)).toBeLessThan(ids.indexOf(decided));
    const w = q.rows.find(r => r.attemptId === waiting)!, d = q.rows.find(r => r.attemptId === decided)!;
    expect(w).toMatchObject({ lights: null, decidedAt: null, why: 'borderline_depth' });
    expect(d).toMatchObject({ lights: ['red', 'white', 'white'], why: 'borderline_depth' });
    expect(d.decidedAt).toBeInstanceOf(Date);
    expect(q.deciding).toBe(q.rows.filter(r => !r.lights).length);
    expect(q.decidedToday).toBeGreaterThanOrEqual(1);
    expect(botQueueLine({ deciding: 1, decidedToday: 4 })).toBe('1 deciding · 4 decided today');
  });

  it("5.33 queue: a decided row whose board is final drops off after its day; one still open stays", async () => {
    const fin = await botDecided('final');
    const open = await botDecided('open');
    await db.update(reviews).set({ createdAt: sql`now() - interval '3 days'` }).where(sql`${reviews.attemptId} in (${fin}, ${open})`);
    const ids = (await botQueue(db)).rows.map(r => r.attemptId);
    expect(ids).not.toContain(fin);
    expect(ids).toContain(open);
  });

  it("the bot's side: each lamp's light, a red's reason and the notes, and 6 frames at most around the judged one", async () => {
    const sq = await botDecided();
    const b = await botSide(db, sq);
    expect(b).toMatchObject({ final: false, changed: false });
    expect(b!.side).toEqual({
      state: 'decided', unavailable: false, lamps: [
        { light: 'red', reason: 'depth', rep: null, note: 'Test answer: red.' },
        { light: 'white', reason: null, rep: null, note: 'Test answer: white.' },
        { light: 'white', reason: null, rep: null, note: 'Test answer: white.' },
      ],
    });
    // three frames at 1.5, 2.0 and 2.5 s; the judged frame is at 3.0 s, so 2.5 s is ringed; all after "Squat!" (1.5 s)
    expect(b!.frames.map(f => [f.tMs, f.judged, f.command])).toEqual([[1500, false, 'Squat!'], [2000, false, 'Squat!'], [2500, true, 'Squat!']]);
  });

  it("the bot's side while it decides, and when it couldn't look: three whites, no notes", async () => {
    await setSetting(db, TEST_ANSWERS_KEY, 'no_key');
    const sq = await closeCall();
    expect((await botSide(db, sq))!.side).toEqual({ state: 'deciding' });
    await enqueue(db, STAGING);
    const b = await botSide(db, sq);
    expect(b!.side).toMatchObject({ state: 'decided', unavailable: true });
    expect((b!.side as { lamps: { note: string | null }[] }).lamps.map(l => l.note)).toEqual([null, null, null]);
  });

  it('"Change the lights": saved with the referee\'s id, it stands, and the clip and her card follow', async () => {
    const sq = await botDecided();
    const ref = await referee();
    expect(await changeLights(db, sq, ref, { lights: ['red', 'red', 'white'], reasons: ['depth', null, null] })).toMatchObject({ status: 400 });
    const r = await changeLights(db, sq, ref, { lights: ['red', 'red', 'white'], reasons: ['depth', 'depth', null] });
    expect(r).toMatchObject({ status: 200, call: 'red' });
    const a = await attempt(sq);
    expect(a).toMatchObject({ status: 'judged', call: 'red', lights: ['red', 'red', 'white'], reason: 'depth', refereeId: ref });
    expect(a.measures).toMatchObject({ referee_bot: true, referee_changed: true, light_reasons: ['depth', 'depth', null] });
    const rs = await db.select().from(reviews).where(eq(reviews.attemptId, sq));
    expect(rs.map(x => [x.byBot, x.refereeId])).toEqual(expect.arrayContaining([[true, null], [false, ref]]));
    // the queue's Lights are the ones that stand; the board above still shows the bot's call
    expect((await botQueue(db)).rows.find(x => x.attemptId === sq)).toMatchObject({ lights: ['red', 'red', 'white'] });
    expect((await botSide(db, sq))!.side).toMatchObject({ lamps: [{ light: 'red' }, { light: 'white' }, { light: 'white' }] });
    // and back to all white: the red reasons go
    await changeLights(db, sq, ref, { lights: ['white', 'white', 'white'] });
    const b = await attempt(sq);
    expect(b).toMatchObject({ call: 'white', reason: null });
    expect((b.measures as Record<string, unknown>).light_reasons).toBeUndefined();
  });

  it('"Change the lights" is never for a final board, a demo, or a close call the bot hasn\'t decided', async () => {
    const ref = await referee();
    const fin = await botDecided('final');
    expect(await changeLights(db, fin, ref, { lights: ['white', 'white', 'white'] })).toMatchObject({ status: 409 });
    expect((await botSide(db, fin))!.final).toBe(true);
    const waiting = await closeCall();
    await db.update(meets).set({ kind: 'real' }).where(eq(meets.id, (await attempt(waiting)).meetId));
    expect(await changeLights(db, waiting, ref, { lights: ['white', 'white', 'white'] })).toMatchObject({ status: 409 });
    const demo = await closeCall();
    expect(await changeLights(db, demo, ref, { lights: ['white', 'white', 'white'] })).toMatchObject({ status: 404 });
  });
});
