// The demo meet's first attempt (5.36) and the referee's close calls (5.33) on Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, events, judgeQueue, lifters, meets, reviews } from '../../web/db/schema';
import { countDemoRun, demoLimitHit, DEMO_SAMPLES, sampleLift, sampleOfAttempt, startDemo } from '../../web/lib/demo';
import { attemptState } from '../../web/lib/attempt-state';
import { declareNext, declareSheet } from '../../web/lib/meet-flow';
import { askAnother, closeCallQueue, saveLights } from '../../web/lib/referee';
import { keys } from '../../web/lib/r2';
import { freshDb, MemStore, URL_ } from './setup';

describe.skipIf(!URL_)('the demo meet and the referee', () => {
  let db: Db, drop: () => Promise<void>;
  const store = new MemStore();
  beforeAll(async () => {
    ({ db, drop } = await freshDb(4));
    for (const c of DEMO_SAMPLES) store.objects.set(keys.sample(c.file), 'video');
  });
  afterAll(async () => drop?.());

  it('"Start the demo meet" makes a demo lifter and the squat opener: 100 lb Barbell, 10 reps at 25 lb Home', async () => {
    const b = await startDemo(db, { cardName: '  Pat   Lee ', division: 'barbell' });
    expect(b.lifter).toMatchObject({ cardName: 'Pat Lee', isDemo: true, division: 'barbell' });
    expect(b.attempt).toMatchObject({ lift: 'squat', number: 1, weight: 100, repsDeclared: null, status: 'declared' });
    expect(b.meet).toMatchObject({ slug: 'demo', kind: 'demo', status: 'open' });
    const h = await startDemo(db, { cardName: '', division: 'home' });
    expect(h.lifter.cardName).toBe('Demo lifter');
    expect(h.attempt).toMatchObject({ weight: 25, repsDeclared: 10 });
    expect(h.meet.id).toBe(b.meet.id);
  });

  it('a sample lift goes through the real path: copied in R2, stored command times, queued; it cycles good then no lift', async () => {
    const { lifter, attempt } = await startDemo(db, { division: 'barbell' });
    const r = await sampleLift(db, store, lifter.id, attempt.id);
    expect(r).toMatchObject({ status: 200, sample: { kind: 'good' }, attempt: { status: 'queued' } });
    const [a] = await db.select().from(attempts).where(eq(attempts.id, attempt.id));
    expect(a).toMatchObject({ isSampleClip: true, status: 'queued', commandTimes: DEMO_SAMPLES[0].meet!.command_times });
    expect(store.objects.has(a.videoKey!)).toBe(true);
    expect(await db.select().from(judgeQueue).where(eq(judgeQueue.attemptId, a.id))).toHaveLength(1);
    // once squat 1 has left the phone, the declare sheet opens for squat 2 (5.26)
    const [l] = await db.select().from(lifters).where(eq(lifters.id, lifter.id));
    const sheet = await declareSheet(db, l);
    expect(sheet).toMatchObject({ kind: 'sheet', slot: { lift: 'squat', number: 2 } });
    if (sheet.kind !== 'sheet') return;
    const pick = sheet.choices.find(c => c.selected)!;
    expect((await declareNext(db, l, pick.value + 0.5)).status).toBe(422); // not one of the cards
    const d = await declareNext(db, l, pick.value);
    expect(d).toMatchObject({ status: 200, attempt: { lift: 'squat', number: 2, weight: pick.value, status: 'declared' } });
    expect(await declareNext(db, l, pick.value)).toMatchObject({ status: 409 }); // squat 2 is now hers to lift
    if (d.status !== 200) return;
    const r2 = await sampleLift(db, store, lifter.id, d.attempt.id);
    expect(r2).toMatchObject({ status: 200, sample: { kind: 'no' } });
  });

  it('the attempt says which sample stood in, so a reload keeps the SAMPLE LIFT box and the credit (item 91)', async () => {
    const { lifter, attempt } = await startDemo(db, { division: 'barbell' });
    await sampleLift(db, store, lifter.id, attempt.id);
    const good = DEMO_SAMPLES.find(c => c.kind === 'good')!;
    const r = await attemptState(db, attempt.id, lifter.id);
    expect(r).toMatchObject({ status: 200, attempt: { sample: true, sample_clip: { id: good.id, credit: good.credit, reps: good.meet!.reps } } });
    // a run noted before the clip was: found by the command times it was given
    await db.update(events).set({ detail: { lifter_id: lifter.id, sample: true, lift: 'squat' } }).where(eq(events.attemptId, attempt.id));
    expect(await sampleOfAttempt(db, attempt.id, good.meet!.command_times)).toMatchObject({ id: good.id });
    expect(await sampleOfAttempt(db, attempt.id, { loaded: 0, squat: 1, rack: 2 })).toBeNull();
    // a filmed lift has none
    const filmed = await startDemo(db, { division: 'barbell' });
    expect(await attemptState(db, filmed.attempt.id, filmed.lifter.id)).toMatchObject({ status: 200, attempt: { sample: false, sample_clip: null } });
  });

  it('a Home sample is judged on the clip\'s reps', async () => {
    const { lifter, attempt } = await startDemo(db, { division: 'home' });
    await sampleLift(db, store, lifter.id, attempt.id);
    const [a] = await db.select().from(attempts).where(eq(attempts.id, attempt.id));
    expect(a.repsDeclared).toBe(DEMO_SAMPLES[0].meet!.reps);
  });

  it('only the demo lifter\'s own attempt, and only a demo lifter', async () => {
    const one = await startDemo(db, {});
    const two = await startDemo(db, {});
    expect((await sampleLift(db, store, two.lifter.id, one.attempt.id)).status).toBe(404);
    const [real] = await db.insert(lifters).values({ cardName: 'Real' }).returning();
    await db.update(attempts).set({ lifterId: real.id }).where(eq(attempts.id, one.attempt.id));
    expect((await sampleLift(db, store, real.id, one.attempt.id)).status).toBe(403);
  });

  it('the limits: 30 a day for one demo lifter, 300 across everyone, from midnight Eastern', async () => {
    const { lifter, attempt } = await startDemo(db, {});
    const env = { DEMO_RUNS_PER_LIFTER_PER_DAY: '3', DEMO_RUNS_PER_DAY: '1000' };
    for (let i = 0; i < 3; i++) await countDemoRun(db, lifter.id, attempt.id, false);
    expect(await demoLimitHit(db, lifter.id, env)).toBe('lifter');
    // yesterday's runs don't count
    await db.update(events).set({ at: new Date(Date.now() - 2 * 86_400_000) }).where(eq(events.kind, 'demo_run'));
    expect(await demoLimitHit(db, lifter.id, env)).toBeNull();
    const other = await startDemo(db, {});
    await countDemoRun(db, other.lifter.id, other.attempt.id, false);
    expect(await demoLimitHit(db, lifter.id, { DEMO_RUNS_PER_LIFTER_PER_DAY: '30', DEMO_RUNS_PER_DAY: '1' })).toBe('everyone');
    expect((await sampleLift(db, store, lifter.id, attempt.id)).status).toBe(200); // default limits
  });

  const closeCallIn = async (kind: 'real' | 'demo', repsDeclared: number | null = null) => {
    const slug = `m-${Math.random().toString(36).slice(2, 8)}`;
    const [m] = await db.insert(meets).values({ slug, name: 'M', kind, status: 'open' }).returning();
    const [l] = await db.insert(lifters).values({ cardName: 'L', isDemo: kind === 'demo', division: repsDeclared ? 'home' : 'barbell' }).returning();
    const [a] = await db.insert(attempts).values({ lifterId: l.id, meetId: m.id, lift: 'squat', number: 1, weight: 100, repsDeclared, status: 'close_call', call: 'close', reason: 'borderline_depth', judgedAt: new Date() }).returning();
    return { a, l };
  };

  it('the queue has real close calls only, and two whites is a good lift', async () => {
    const [ref] = await db.insert(lifters).values({ cardName: 'Ref', isReferee: true }).returning();
    const { a } = await closeCallIn('real');
    const { a: demo } = await closeCallIn('demo');
    const q = await closeCallQueue(db, ref.id);
    expect(q.map(r => r.attemptId)).toContain(a.id);
    expect(q.map(r => r.attemptId)).not.toContain(demo.id);
    expect((await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['white', 'red'] as never })).status).toBe(400);
    expect((await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['white', 'red', 'red'] })).status).toBe(400); // red needs a reason
    expect((await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['white', 'white', 'red'] })).status).toBe(400); // so does a single red
    expect((await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['white', 'red', 'red'], reasons: [null, 'depth', null] })).status).toBe(400); // every red
    const r = await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['white', 'white', 'red'], reasons: [null, null, 'moved_feet'] });
    expect(r).toMatchObject({ status: 200, call: 'white' });
    const [saved] = await db.select().from(attempts).where(eq(attempts.id, a.id));
    expect(saved).toMatchObject({ status: 'judged', call: 'white', refereeId: ref.id, reason: null });
    expect(saved.measures).toMatchObject({ light_reasons: [null, null, 'moved_feet'] });
    const rv = await db.select().from(reviews).where(eq(reviews.attemptId, a.id));
    expect(rv).toHaveLength(1);
    expect(rv[0].reason).toBe('moved_feet');
    expect((await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['white', 'white', 'white'] })).status).toBe(409);
  });

  it('a Home red needs the rep; it is saved with the reason', async () => {
    const [ref] = await db.insert(lifters).values({ cardName: 'Ref2', isReferee: true }).returning();
    const { a } = await closeCallIn('real', 10);
    expect((await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['red', 'red', 'white'], reason: 'depth' })).status).toBe(400);
    const r = await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['red', 'red', 'white'], reasons: ['depth', 'no_lockout', null], rep: 4 });
    expect(r).toMatchObject({ status: 200, call: 'red' });
    const [saved] = await db.select().from(attempts).where(eq(attempts.id, a.id));
    expect(saved.measures).toMatchObject({ red_rep: 4, referee: true, light_reasons: ['depth', 'no_lockout', null] });
    expect(saved.reason).toBe('no_lockout'); // a tie goes to the head referee
  });

  it('a Home single red needs its rep too', async () => {
    const [ref] = await db.insert(lifters).values({ cardName: 'Ref2b', isReferee: true }).returning();
    const { a } = await closeCallIn('real', 8);
    expect((await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['white', 'red', 'white'], reasons: [null, 'depth', null] })).status).toBe(400);
    expect((await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['white', 'red', 'white'], reasons: [null, 'depth', null], rep: 2 })).status).toBe(200);
  });

  it('"Ask another referee": back in the queue for others, once, and the asker can\'t decide it', async () => {
    const [r1] = await db.insert(lifters).values({ cardName: 'R1', isReferee: true }).returning();
    const [r2] = await db.insert(lifters).values({ cardName: 'R2', isReferee: true }).returning();
    const { a } = await closeCallIn('real');
    expect((await askAnother(db, a.id, r1.id, 'hard angle')).status).toBe(200);
    expect((await closeCallQueue(db, r1.id)).map(r => r.attemptId)).not.toContain(a.id);
    const seen = (await closeCallQueue(db, r2.id)).find(r => r.attemptId === a.id);
    expect(seen?.secondOpinion).toBe(true);
    expect((await askAnother(db, a.id, r2.id, null)).status).toBe(409);
    expect((await saveLights(db, a.id, { kind: 'referee', id: r1.id }, { lights: ['white', 'white', 'white'] })).status).toBe(409);
    expect((await saveLights(db, a.id, { kind: 'referee', id: r2.id }, { lights: ['red', 'red', 'red'], reason: 'depth' })).status).toBe(200);
  });

  it('the demo referee decides only their own demo close call; referees never decide demo ones', async () => {
    const { a, l } = await closeCallIn('demo');
    const [ref] = await db.insert(lifters).values({ cardName: 'R3', isReferee: true }).returning();
    const [stranger] = await db.insert(lifters).values({ cardName: 'D2', isDemo: true }).returning();
    expect((await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['white', 'white', 'white'] })).status).toBe(403);
    expect((await saveLights(db, a.id, { kind: 'demo', lifterId: stranger.id }, { lights: ['white', 'white', 'white'] })).status).toBe(403);
    expect((await saveLights(db, a.id, { kind: 'demo', lifterId: l.id }, { lights: ['white', 'red', 'white'], reasons: [null, 'depth', null] })).status).toBe(200);
    const [rv] = await db.select().from(reviews).where(eq(reviews.attemptId, a.id));
    expect(rv.refereeId).toBeNull();
  });
});
