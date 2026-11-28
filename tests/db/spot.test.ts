// Spot checks on Postgres (plan 3.4d step 8, 5.33, 5.35's gate; items 104 and 105): who is checked,
// the job, the frames, the bot's one call (faked by staging's `spot_weight_1` only where Anthropic
// answers), the red it makes, a person standing over it, and "Make the board final" waiting for them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, lifters, meets, opsSettings, refereeJobs, reviews, spotChecks } from '../../web/db/schema';
import { LIFTS } from '../../web/lib/meet';
import { keys } from '../../web/lib/r2';
import { boardFinalReady } from '../../web/lib/meet-window';
import { framesJob, framesStarted, lease, runJob, setSetting, spotTick, takeFrames, TEST_ANSWERS_KEY, type FrameStore } from '../../web/lib/referee/bot';
import { decideSpot, notSameLifter, spotChecksDone, topThree } from '../../web/lib/referee/spot';
import { meetLifters } from '../../web/lib/host-data';
import { spotChangedLine } from '../../web/lib/referee/spot';
import { spotDesk } from '../../web/lib/referee/spot-desk';
import { freshDb, MemStore, URL_ } from './setup';

class FramesStore extends MemStore implements FrameStore {
  async signedPut(key: string) { return `https://r2.test/${key}?put`; }
  async get(key: string) { return this.objects.has(key) ? new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])) : null; }
}

const STAGING = { STAGING_TEST_SIGNIN: 'on', RENDER_SERVICE_NAME: 'first-meet-web-staging' };
const closes = new Date(Date.now() - 2 * 86_400_000);

describe.skipIf(!URL_)('spot checks', () => {
  let db: Db, drop: () => Promise<void>;
  const store = new FramesStore();
  beforeAll(async () => { ({ db, drop } = await freshDb(4)); });
  afterAll(async () => drop?.());

  async function meet(slug: string, at = closes) {
    const [m] = await db.insert(meets).values({ slug, name: 'Winter 2027', kind: 'test', status: 'open', opensAt: new Date(at.getTime() - 86_400_000), closesAt: at }).returning();
    return m;
  }
  /** A Barbell lifter with nine judged whites, each clip in R2; `base` sets her total. */
  async function lifter(meetId: string, name: string, base: number, ageGroup = 'Open') {
    const [l] = await db.insert(lifters).values({ cardName: name, email: `${name.toLowerCase()}@first-meet.invalid`, division: 'barbell', units: 'kg', meetId, ageGroup }).returning();
    await db.insert(attempts).values(LIFTS.flatMap(lift => [1, 2, 3].map(number => ({
      lifterId: l.id, meetId, lift, number, weight: base + number * 10, status: 'judged' as const, call: 'white' as const,
      lights: ['white', 'white', 'white'] as const, videoKey: `meet/x/${l.id}/${lift}${number}.webm`, judgedFrameMs: 3000,
      commandTimes: lift === 'squat' ? { loaded: 200, squat: 1500, rack: 6000 } : { loaded: 200, start: 1000, rack: 5000 },
      recordedAt: closes, judgedAt: closes,
    }))).map(a => ({ ...a, lights: [...a.lights] })));
    for (const lift of LIFTS) for (const n of [1, 2, 3]) store.objects.set(`meet/x/${l.id}/${lift}${n}.webm`, 'video');
    return l;
  }
  const spot = async (lifterId: string) => (await db.select().from(spotChecks).where(eq(spotChecks.lifterId, lifterId)))[0];
  const squat1 = async (lifterId: string) => (await db.select().from(attempts).where(eq(attempts.lifterId, lifterId)))
    .find(a => a.lift === 'squat' && a.number === 1)!;

  it('the top 3 of each age group, by the board', async () => {
    const m = await meet('top3');
    const ids = [];
    for (const [i, base] of [100, 140, 120, 90].entries()) ids.push((await lifter(m.id, `Top${i}`, base)).id);
    const young = await lifter(m.id, 'Young', 50, '18–23');
    const top = topThree(await meetLifters(db, m.id));
    expect(top).toEqual([ids[1], ids[2], ids[0], young.id]);
  });

  it('none before the clip deadline; with the bot off and no test answer, rows wait for a person and the board waits too', async () => {
    const m = await meet('soon', new Date(Date.now() - 60_000));
    await lifter(m.id, 'Soon', 100);
    await spotTick(db, STAGING);
    expect(await db.select().from(spotChecks).where(eq(spotChecks.meetId, m.id))).toHaveLength(0);

    const late = await meet('waits');
    const ana = await lifter(late.id, 'Ana', 100);
    await spotTick(db, STAGING);
    expect(await spot(ana.id)).toMatchObject({ jobId: null, bot: null, person: null });
    expect(await spotChecksDone(db, late.id)).toEqual({ done: false, waiting: 1 });
    expect(await boardFinalReady(db, late)).toMatchObject({ ok: false, why: 'spot_checks' });
    // a person's "Checked" lets the board be made final
    expect(await decideSpot(db, ana.id, null, { outcome: 'checked', problems: [] })).toBe('ok');
    expect(await boardFinalReady(db, late)).toEqual({ ok: true });
  });

  it('item 104: "Spot check: weight not visible on attempt 1" turns her Squat 1 red, three reds, once', async () => {
    await db.delete(opsSettings);
    const m = await meet('test-answer');
    const bea = await lifter(m.id, 'Bea', 100);
    await setSetting(db, TEST_ANSWERS_KEY, 'spot_weight_1');
    await spotTick(db, STAGING);
    const row = await spot(bea.id);
    expect(row.jobId).toBeTruthy();
    const [job] = await db.select().from(refereeJobs).where(eq(refereeJobs.id, row.jobId!));
    expect(job).toMatchObject({ kind: 'spot_check', lifterId: bea.id, testAnswers: 'spot_weight_1', status: 'waiting_frames' });
    // used up
    expect((await db.select().from(opsSettings)).find(s => s.key === TEST_ANSWERS_KEY)?.value ?? null).toBeNull();

    const sent = await framesJob(db, store, job.id, STAGING) as { clips: { label: string; start_ms: number | null; weight_ms: number | null; attempt_id: string }[]; upload_urls: string[] };
    expect(sent.clips).toHaveLength(9);
    expect(sent.clips[0]).toMatchObject({ label: 'Attempt 1: Squat 1 · 110 kg', start_ms: 1500, weight_ms: 3000 });
    expect(sent.clips[3].label).toMatch(/^Attempt 4: Bench press 1 · /);
    expect(sent.upload_urls).toHaveLength(18);

    await framesStarted(db, job.id);
    const frames = sent.clips.flatMap((c, i) => [0, 1].map(k => ({ n: i * 2 + k, t_ms: k ? 3000 : 1500, attempt_id: c.attempt_id })));
    for (const f of frames) store.objects.set(keys.spotFrame(job.id, f.n), 'jpeg');
    expect(await takeFrames(db, { job_id: job.id, ok: true, frames })).toMatchObject({ status: 200, ready: true });
    expect(await lease(db, 'spot-test', 4)).toContain(job.id);
    expect(await runJob(db, job.id, 'spot-test', { store, client: null, env: STAGING })).toBe('done');

    const a = await squat1(bea.id);
    expect(a).toMatchObject({ call: 'red', lights: ['red', 'red', 'red'], reason: 'weight_not_shown', spotChecked: true });
    expect((a.measures as { spot_check: { before: { call: string } } }).spot_check.before.call).toBe('white');
    expect(await db.select().from(reviews).where(eq(reviews.attemptId, a.id))).toMatchObject([{ kind: 'spot_check', byBot: true, reason: 'weight_not_shown' }]);
    expect((await spot(bea.id)).bot).toEqual({ outcome: 'problem', problems: [{ kind: 'weight_not_visible', attemptId: a.id }] });
    expect(await spotChecksDone(db, m.id)).toEqual({ done: true, waiting: 0 });
    // the other eight stay as they were
    const rest = (await db.select().from(attempts).where(eq(attempts.lifterId, bea.id))).filter(x => x.id !== a.id);
    expect(rest.every(x => x.call === 'white')).toBe(true);

    // her total page says so only when the red changed her total (Squat 1 isn't her best squat: no line)
    expect(await spotChangedLine(db, { ...bea, division: 'barbell' })).toBeNull();
    // the desk: no name, nine clips, the bot's line
    const desk = await spotDesk(db, STAGING, m.id);
    const mine = desk!.rows.find(r => r.lifterId === bea.id)!;
    expect(mine).toMatchObject({ group: 'Barbell · Open', botLine: 'Referee bot: weight not visible on Squat 1.', done: true });
    expect(mine.clips).toHaveLength(9);
    expect(mine.clips[0]).toMatchObject({ hud: 'SQUAT · 1', light: 'red' });
    expect(JSON.stringify(mine)).not.toContain('Bea');

    // a person's "Checked" puts it back; the board can then be final, and nothing changes after
    expect(await decideSpot(db, bea.id, null, { outcome: 'checked', problems: [] })).toBe('ok');
    const back = await squat1(bea.id);
    expect(back).toMatchObject({ call: 'white', lights: ['white', 'white', 'white'], reason: null });
    expect((back.measures as { spot_check: { undone?: string } }).spot_check.undone).toBeTruthy();
    await db.update(meets).set({ status: 'final' }).where(eq(meets.id, m.id));
    expect(await decideSpot(db, bea.id, null, { outcome: 'problem', problems: [{ kind: 'weight_not_visible', attemptId: a.id }] })).toBe('final');
  });

  it('with the bot on and no key: doubt at once, which counts as checked and changes nothing', async () => {
    const m = await meet('no-key');
    const cy = await lifter(m.id, 'Cy', 100);
    await spotTick(db, { REFEREE_BOT: 'on' });
    const row = await spot(cy.id);
    expect(row.bot).toEqual({ outcome: 'doubt', problems: [] });
    const [job] = await db.select().from(refereeJobs).where(eq(refereeJobs.id, row.jobId!));
    expect(job).toMatchObject({ status: 'doubt', doubtReason: 'no_key' });
    expect((await squat1(cy.id)).call).toBe('white');
    expect(await spotChecksDone(db, m.id)).toEqual({ done: true, waiting: 0 });
  });

  it("a person's Problem reds the attempt; an attempt already red stays red; 'not the same lifter' shows on /ops only", async () => {
    const m = await meet('person');
    const di = await lifter(m.id, 'Di', 100);
    await spotTick(db, STAGING);
    const a = await squat1(di.id);
    const dl3 = (await db.select().from(attempts).where(eq(attempts.lifterId, di.id))).find(x => x.lift === 'deadlift' && x.number === 3)!;
    await db.update(attempts).set({ call: 'red', lights: ['red', 'red', 'white'], reason: 'no_lockout' }).where(eq(attempts.id, dl3.id));
    await decideSpot(db, di.id, null, { outcome: 'problem', problems: [
      { kind: 'weight_not_visible', attemptId: a.id }, { kind: 'weight_not_visible', attemptId: dl3.id }, { kind: 'not_same_lifter' },
    ] });
    expect(await squat1(di.id)).toMatchObject({ call: 'red', reason: 'weight_not_shown' });
    // all three squats red (the deadlift 3 was red already): no squat counts, she bombs out, and the page says why
    for (const n of [2, 3]) {
      const sq = (await db.select().from(attempts).where(eq(attempts.lifterId, di.id))).find(x => x.lift === 'squat' && x.number === n)!;
      await decideSpot(db, di.id, null, { outcome: 'problem', problems: [
        { kind: 'weight_not_visible', attemptId: a.id }, { kind: 'weight_not_visible', attemptId: sq.id }, { kind: 'not_same_lifter' },
      ] });
    }
    expect(await spotChangedLine(db, { ...di, division: 'barbell' })).toBe('A spot check found a problem with your Squat 1, so your total changed.')
    expect((await db.select().from(attempts).where(eq(attempts.id, dl3.id)))[0]).toMatchObject({ lights: ['red', 'red', 'white'], reason: 'no_lockout' });
    expect(await notSameLifter(db, m.id)).toEqual([{ id: di.id, name: 'Di' }]);
  });
});
