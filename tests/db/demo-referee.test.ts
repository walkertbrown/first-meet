// The demo meet's first attempt (5.36) and the referee's close calls (5.33) on Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, events, judgeQueue, lifters, meets, reviews } from '../../web/db/schema';
import { countDemoRun, demoLimitHit, DEMO_SAMPLES, liftAgain, sampleLift, startDemo } from '../../web/lib/demo';
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
    const again = await liftAgain(db, lifter.id);
    const r2 = await sampleLift(db, store, lifter.id, again!.id);
    expect(r2).toMatchObject({ status: 200, sample: { kind: 'no' } });
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
    const r = await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['white', 'white', 'red'] });
    expect(r).toMatchObject({ status: 200, call: 'white' });
    const [saved] = await db.select().from(attempts).where(eq(attempts.id, a.id));
    expect(saved).toMatchObject({ status: 'judged', call: 'white', refereeId: ref.id, reason: null });
    expect(await db.select().from(reviews).where(eq(reviews.attemptId, a.id))).toHaveLength(1);
    expect((await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['white', 'white', 'white'] })).status).toBe(409);
  });

  it('a Home red needs the rep; it is saved with the reason', async () => {
    const [ref] = await db.insert(lifters).values({ cardName: 'Ref2', isReferee: true }).returning();
    const { a } = await closeCallIn('real', 10);
    expect((await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['red', 'red', 'white'], reason: 'depth' })).status).toBe(400);
    const r = await saveLights(db, a.id, { kind: 'referee', id: ref.id }, { lights: ['red', 'red', 'white'], reason: 'depth', rep: 4 });
    expect(r).toMatchObject({ status: 200, call: 'red' });
    const [saved] = await db.select().from(attempts).where(eq(attempts.id, a.id));
    expect(saved.measures).toMatchObject({ red_rep: 4, referee: true });
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
    expect((await saveLights(db, a.id, { kind: 'demo', lifterId: l.id }, { lights: ['white', 'red', 'white'] })).status).toBe(200);
    const [rv] = await db.select().from(reviews).where(eq(reviews.attemptId, a.id));
    expect(rv.refereeId).toBeNull();
  });
});
