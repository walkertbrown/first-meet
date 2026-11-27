// A bomb-out's best lift (plan 5.28, 3.9 step 6, item 101): the clip is queued for her best good attempt when the
// ninth lands, it ends on that lift's end frame (no card link), the poster goes beside it, and the page's block
// follows the clip: being made, ready, couldn't be made, "Try again" once. No good attempt: no clip at all.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, judgeQueue, judgeWorkers, lifters, meets } from '../../web/db/schema';
import { ORDER } from '../../web/lib/meet';
import { claimClip, queueCardClip, takeClip } from '../../web/lib/card/clip-job';
import { bestLiftFor, retryBestLift } from '../../web/lib/card/best-lift-data';
import { endFrameOk } from '../../web/lib/card/best-lift';
import { keys } from '../../web/lib/r2';
import { resetBackoff } from '../../web/lib/dispatcher';
import { freshDb, MemStore, URL_ } from './setup';

const NOW = new Date('2027-02-26T18:00:00Z');
const CT = { loaded: 0, squat: 2000, rack: 6000 };

class Store extends MemStore {
  async signedPut(key: string) { return `https://r2.test/${key}?put`; }
}

type Call = 'white' | 'red';

describe.skipIf(!URL_)('a bomb-out\'s best lift', () => {
  let db: Db, drop: () => Promise<void>;
  const store = new Store();
  const secret = 'test-callback-secret';
  let saved: string | undefined;
  beforeAll(async () => {
    ({ db, drop } = await freshDb(5));
    saved = process.env.JUDGE_CALLBACK_SECRET;
    process.env.JUDGE_CALLBACK_SECRET = secret;
  });
  afterAll(async () => {
    if (saved === undefined) delete process.env.JUDGE_CALLBACK_SECRET; else process.env.JUDGE_CALLBACK_SECRET = saved;
    await drop?.();
  });
  beforeEach(async () => { resetBackoff(); await db.delete(judgeQueue); await db.delete(judgeWorkers); });

  /** Nine judged attempts with these calls, in meet order: squat 1–3, bench 1–3, deadlift 1–3. */
  async function lifter(calls: Call[], weights = [95, 105, 115, 65, 70, 75, 135, 145, 155], extra: Partial<typeof lifters.$inferInsert> = {}, reps: (number | null)[] = []) {
    const [m] = await db.insert(meets).values({
      slug: `m-${randomBytes(4).toString('hex')}`, name: 'Winter 2027', kind: 'real', status: 'open',
      opensAt: new Date('2027-02-26T11:00:00Z'), closesAt: new Date('2027-02-27T23:00:00Z'),
    }).returning();
    const [l] = await db.insert(lifters).values({ cardName: 'Diane R.', division: 'barbell', meetId: m.id, ...extra }).returning();
    const rows = [];
    for (let k = 0; k < 9; k++) {
      const [a] = await db.insert(attempts).values({
        lifterId: l.id, meetId: m.id, lift: ORDER[k].lift, number: ORDER[k].number, weight: weights[k], repsDeclared: reps[k] ?? null,
        status: 'judged', call: calls[k], lights: calls[k] === 'white' ? ['white', 'white', 'white'] : ['red', 'red', 'red'],
        reason: calls[k] === 'red' ? 'depth' : null, videoKey: `videos/${l.id}/${k}.webm`, commandTimes: CT,
      }).returning();
      rows.push(a);
    }
    return { l, rows };
  }
  const row = async (id: string) => (await db.select().from(lifters).where(eq(lifters.id, id)))[0];
  const clipRows = async (lifterId: string) => (await db.select({ q: judgeQueue, a: attempts }).from(judgeQueue)
    .innerJoin(attempts, eq(attempts.id, judgeQueue.attemptId)).where(eq(attempts.lifterId, lifterId))).filter(r => r.q.kind === 'clip');

  const W = 'white' as const, R = 'red' as const;

  it('bombed the bench: queued once, for her heaviest good lift, with no card to show', async () => {
    // squat 95 / 105 / 115 good, bench all red, deadlift 135 / 145 good and 155 red
    const { l, rows } = await lifter([W, W, W, R, R, R, W, W, R]);
    expect(await queueCardClip(db, l.id, NOW)).toBe(rows[7].id);
    expect(await queueCardClip(db, l.id, NOW)).toBeNull();
    const q = await clipRows(l.id);
    expect(q.map(r => r.q.attemptId)).toEqual([rows[7].id]);
    expect(q[0].q.clipSeconds).toBeLessThanOrEqual(15);
  });

  it('a tie goes to the later attempt, as on the card', async () => {
    const { l, rows } = await lifter([W, W, W, R, R, R, W, W, R], [95, 105, 145, 65, 70, 75, 135, 145, 155]);
    expect(await queueCardClip(db, l.id, NOW)).toBe(rows[7].id);
  });

  it('Home: her best score, weight times reps', async () => {
    // the goblet squat's 25 × 12 (300) beats its 30 × 8 (240), and the deadlift's 20s × 6 (240 as a pair); the press bombed
    const { l, rows } = await lifter([W, W, W, R, R, R, W, R, R], [25, 30, 25, 15, 15, 15, 20, 30, 30],
      { division: 'home', units: 'lb' }, [8, 8, 12, 8, 8, 8, 6, 8, 8]);
    expect(await queueCardClip(db, l.id, NOW)).toBe(rows[2].id);
  });

  it('no good attempt at all: no clip, and the block shows nothing', async () => {
    const { l } = await lifter([R, R, R, R, R, R, R, R, R]);
    expect(await queueCardClip(db, l.id, NOW)).toBeNull();
    expect(await clipRows(l.id)).toHaveLength(0);
    expect(await bestLiftFor(db, await row(l.id), NOW)).toBeNull();
  });

  it('a total has no best-lift block: that clip is the card\'s', async () => {
    const { l } = await lifter([W, W, W, W, W, W, W, W, W]);
    expect(await bestLiftFor(db, await row(l.id), NOW)).toBeNull();
  });

  it('the clip run gets her best lift\'s end frame, signed, and a place for the poster', async () => {
    const { l, rows } = await lifter([W, W, W, R, R, R, W, W, R]);
    await queueCardClip(db, l.id, NOW);
    await db.insert(judgeWorkers).values({ workerId: 'b-1' });
    const job = await claimClip(db, store, 'b-1');
    const id = rows[7].id;
    expect(job).toMatchObject({ attempt_id: id, lift_line: 'DEADLIFT · 2 OF 3', weight: '145 lb', lamps: ['white', 'white', 'white'] });
    expect(job!.upload_url).toBe(`https://r2.test/${keys.clip(id)}?put`);
    expect(job!.poster_url).toBe(`https://r2.test/${keys.clipPoster(id)}?put`);
    const u = new URL(job!.card_path, 'https://x');
    expect(u.pathname).toBe(`/api/internal/end-frame/${id}.png`);
    expect(endFrameOk(id, u.searchParams.get('t'), u.searchParams.get('s'), secret)).toBe(true);
    expect(job!.card_path).not.toMatch(/\/api\/card\//);
  });

  it('the block follows the clip: being made, ready; its words are the lift\'s', async () => {
    const { l, rows } = await lifter([W, W, W, R, R, R, W, W, R]);
    await queueCardClip(db, l.id, NOW);
    const id = rows[7].id;
    let b = await bestLiftFor(db, await row(l.id), NOW);
    expect(b).toMatchObject({ attemptId: id, ready: false, failed: null });
    expect(b!.view).toMatchObject({ liftLine: 'DEADLIFT · 2 OF 3', weight: '145', unitLine: 'LB' });
    expect(b!.view.label).toBe("Diane R.'s best lift: deadlift, attempt 2, 145 lb, three white lights.");
    expect(b!.lengthMs).toBeGreaterThan(6800);
    expect(b!.lengthMs).toBeLessThanOrEqual(15_000);
    await db.insert(judgeWorkers).values({ workerId: 'b-2' });
    await claimClip(db, store, 'b-2');
    store.objects.set(keys.clip(id), 'mp4');
    expect((await takeClip(db, store, { attempt_id: id, worker_id: 'b-2', ok: true, secs: 10 })).status).toBe(200);
    b = await bestLiftFor(db, await row(l.id), NOW);
    expect(b).toMatchObject({ ready: true, failed: null });
    expect(await retryBestLift(db, await row(l.id))).toBe(false);
  });

  it('couldn\'t be made: "Try again" once (item 102), then the last failure', async () => {
    const { l, rows } = await lifter([W, W, W, R, R, R, W, W, R]);
    await queueCardClip(db, l.id, NOW);
    const id = rows[7].id;
    await db.insert(judgeWorkers).values([{ workerId: 'b-3' }, { workerId: 'b-4' }, { workerId: 'b-5' }]);
    const fail = async (w: string) => { await claimClip(db, store, w); await takeClip(db, store, { attempt_id: id, worker_id: w, ok: false, error: 'FAULT=clip set' }); };
    expect(await retryBestLift(db, await row(l.id))).toBe(false);
    await fail('b-3');
    await fail('b-4');
    expect(await bestLiftFor(db, await row(l.id), NOW)).toMatchObject({ ready: false, failed: 'retry' });
    expect(await retryBestLift(db, await row(l.id))).toBe(true);
    expect(await bestLiftFor(db, await row(l.id), NOW)).toMatchObject({ ready: false, failed: null });
    expect(await retryBestLift(db, await row(l.id))).toBe(false);
    await fail('b-5');
    expect(await bestLiftFor(db, await row(l.id), NOW)).toMatchObject({ ready: false, failed: 'final' });
    expect(await retryBestLift(db, await row(l.id))).toBe(false);
  });
});
