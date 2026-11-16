// Her lift clip's queue (3.9 step 6, piece 7): queued once when her total lands, for the lift on her card,
// moved only if a referee changes which lift that is; made only while no poses row waits; tried twice.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, events, judgeQueue, judgeWorkers, lifters, meets } from '../../web/db/schema';
import { ORDER } from '../../web/lib/meet';
import { claimClip, clipAfterLights, clipCounts, expireClipLeases, queueCardClip, takeClip } from '../../web/lib/card/clip-job';
import { resetBackoff, tick, type Runner } from '../../web/lib/dispatcher';
import { keys } from '../../web/lib/r2';
import { freshDb, MemStore, URL_ } from './setup';

const NOW = new Date('2027-02-26T18:00:00Z');
const WEIGHTS = [95, 105, 115, 65, 70, 75, 135, 145, 155];
const CT = { loaded: 0, squat: 2000, rack: 6000 };
const BIG = { runStartsPerMin: 100, cpuPerMin: 200, workersMax: 100 };

class Store extends MemStore {
  async signedPut(key: string) { return `https://r2.test/${key}?put`; }
}

class FakeRunner implements Runner {
  starts: { workerId: string; task?: string }[] = [];
  async start(workerId: string, task?: string) { this.starts.push({ workerId, task }); return { ok: true as const, runId: `run-${workerId}` }; }
  async status() { return 'running'; }
}

describe.skipIf(!URL_)('her lift clip', () => {
  let db: Db, drop: () => Promise<void>;
  const store = new Store();
  beforeAll(async () => { ({ db, drop } = await freshDb(5)); });
  afterAll(async () => drop?.());
  beforeEach(async () => { resetBackoff(); await db.delete(judgeQueue); await db.delete(judgeWorkers); });

  /** Nine attempts; the last `judged` of them leave the rest `queued`, so she has no total yet. */
  async function lifter(judged = 9) {
    const [m] = await db.insert(meets).values({
      slug: `m-${randomBytes(4).toString('hex')}`, name: 'Winter 2027', kind: 'real', status: 'open',
      opensAt: new Date('2027-02-26T11:00:00Z'), closesAt: new Date('2027-02-27T23:00:00Z'),
    }).returning();
    const [l] = await db.insert(lifters).values({ cardName: 'Diane R.', division: 'barbell', meetId: m.id }).returning();
    const rows = [];
    for (let k = 0; k < 9; k++) {
      const done = k < judged;
      const [a] = await db.insert(attempts).values({
        lifterId: l.id, meetId: m.id, lift: ORDER[k].lift, number: ORDER[k].number, weight: WEIGHTS[k],
        status: done ? 'judged' : 'queued', call: done ? 'white' : null, lights: done ? ['white', 'white', 'white'] : null,
        videoKey: `videos/${l.id}/${k}.webm`, commandTimes: CT,
      }).returning();
      rows.push(a);
    }
    return { l, rows };
  }
  const clipRows = (ids: string[]) => db.select().from(judgeQueue).where(and(eq(judgeQueue.kind, 'clip'), sql`${judgeQueue.attemptId} in ${ids}`));
  const status = async (id: string) => (await db.select({ s: attempts.clipStatus }).from(attempts).where(eq(attempts.id, id)))[0].s;

  it('not before her total; once it lands, once, for her heaviest bar', async () => {
    const { l, rows } = await lifter(8);
    expect(await queueCardClip(db, l.id, NOW)).toBeNull();
    await db.update(attempts).set({ status: 'judged', call: 'white', lights: ['white', 'white', 'white'] }).where(eq(attempts.id, rows[8].id));
    expect(await queueCardClip(db, l.id, NOW)).toBe(rows[8].id);
    expect(await queueCardClip(db, l.id, NOW)).toBeNull();
    const q = await clipRows(rows.map(r => r.id));
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ attemptId: rows[8].id, workerId: null });
    expect(q[0].clipSeconds).toBeGreaterThan(6.8);   // footage plus the lamps, the hold and her card
    expect(q[0].clipSeconds).toBeLessThanOrEqual(15);
    expect(await status(rows[8].id)).toBe('queued');
    const ev = await db.select().from(events).where(and(eq(events.kind, 'clip_queued'), eq(events.attemptId, rows[8].id)));
    expect(ev).toHaveLength(1);
  });

  it('a referee who changes her best lift moves the waiting clip to it', async () => {
    const { l, rows } = await lifter();
    await queueCardClip(db, l.id, NOW);
    // her 155 deadlift turned red: her best is now the 145
    await db.update(attempts).set({ call: 'red', lights: ['red', 'red', 'white'] }).where(eq(attempts.id, rows[8].id));
    expect(await queueCardClip(db, l.id, NOW)).toBe(rows[7].id);
    expect((await clipRows(rows.map(r => r.id))).map(r => r.attemptId)).toEqual([rows[7].id]);
  });

  it('only while no poses row waits, then leased to the run asking', async () => {
    const { l, rows } = await lifter();
    await queueCardClip(db, l.id, NOW);
    const other = await lifter(8);
    await db.insert(judgeQueue).values({ attemptId: other.rows[8].id, kind: 'poses' });
    await db.insert(judgeWorkers).values({ workerId: 'c-1' });
    expect(await claimClip(db, store, 'c-1')).toBeNull();
    await db.delete(judgeQueue).where(eq(judgeQueue.kind, 'poses'));
    const job = await claimClip(db, store, 'c-1');
    expect(job).toMatchObject({
      attempt_id: rows[8].id, worker_id: 'c-1', lamps: ['white', 'white', 'white'], mirror: true, marks: null,
      lift_line: 'DEADLIFT · 3 OF 3', weight: '155 lb', start_ms: 0, end_ms: 7000,   // from "loaded" (clamped at 0) to a second after "rack"
      upload_url: `https://r2.test/${keys.clip(rows[8].id)}?put`,
    });
    expect(job!.card_path).toMatch(/^\/api\/card\/[\w-]+\.png\?f=story$/);
    expect(job!.judged_ms).toBeGreaterThanOrEqual(job!.start_ms);
    expect(job!.judged_ms).toBeLessThan(job!.end_ms);
    expect(await status(rows[8].id)).toBe('rendering');
    expect(await claimClip(db, store, 'c-1')).toBeNull();
  });

  it('made: the MP4 must be in storage, then it is ready', async () => {
    const { l, rows } = await lifter();
    await queueCardClip(db, l.id, NOW);
    await db.insert(judgeWorkers).values({ workerId: 'c-2' });
    await claimClip(db, store, 'c-2');
    const id = rows[8].id;
    expect((await takeClip(db, store, { attempt_id: id, worker_id: 'c-other', ok: true })).status).toBe(409);
    store.objects.set(keys.clip(id), 'mp4');
    expect((await takeClip(db, store, { attempt_id: id, worker_id: 'c-2', ok: true, secs: 9.5 })).status).toBe(200);
    expect(await status(id)).toBe('ready');
    const [a] = await db.select({ k: attempts.clipKey }).from(attempts).where(eq(attempts.id, id));
    expect(a.k).toBe(keys.clip(id));
    expect(await clipRows([id])).toHaveLength(0);
    expect((await db.select().from(judgeWorkers).where(eq(judgeWorkers.workerId, 'c-2')))[0].attemptsDone).toBe(1);
    expect((await takeClip(db, store, { attempt_id: id, worker_id: 'c-2', ok: true })).status).toBe(404);
    // made once: her next lights don't queue it again
    await clipAfterLights(db, id);
    expect(await clipRows([id])).toHaveLength(0);
  });

  it('not made: tried once more, then failed', async () => {
    const { l, rows } = await lifter();
    await queueCardClip(db, l.id, NOW);
    const id = rows[8].id;
    await db.insert(judgeWorkers).values([{ workerId: 'c-3' }, { workerId: 'c-4' }]);
    await claimClip(db, store, 'c-3');
    await takeClip(db, store, { attempt_id: id, worker_id: 'c-3', ok: false, error: 'cannot decode' });
    expect(await status(id)).toBe('queued');
    expect((await clipRows([id]))[0]).toMatchObject({ requeued: true, workerId: null, lastError: 'cannot decode' });
    await claimClip(db, store, 'c-4');
    // says it's made, but nothing is in storage
    await takeClip(db, store, { attempt_id: id, worker_id: 'c-4', ok: true });
    expect(await status(id)).toBe('failed');
    expect(await clipRows([id])).toHaveLength(0);
  });

  it('a lease that runs out is a failure too, and that run is ended', async () => {
    const { l, rows } = await lifter();
    await queueCardClip(db, l.id, NOW);
    const id = rows[8].id;
    await db.insert(judgeWorkers).values({ workerId: 'c-5' });
    await claimClip(db, store, 'c-5');
    await db.update(judgeQueue).set({ leasedUntil: sql`now() - interval '1 second'` }).where(eq(judgeQueue.attemptId, id));
    expect(await expireClipLeases(db)).toEqual([id]);
    expect(await status(id)).toBe('queued');
    expect((await db.select().from(judgeWorkers).where(eq(judgeWorkers.workerId, 'c-5')))[0].endedAt).not.toBeNull();
  });

  it('the dispatcher starts render_clip only when no poses wait, and clip runs are not pose workers', async () => {
    const { l } = await lifter();
    await queueCardClip(db, l.id, NOW);
    const other = await lifter(8);
    await db.update(attempts).set({ status: 'uploading' }).where(eq(attempts.id, other.rows[8].id));
    await db.insert(judgeQueue).values({ attemptId: other.rows[8].id, kind: 'poses' });
    const r = new FakeRunner();
    const t1 = await tick(db, r, BIG);
    expect(t1.clipStarted).toEqual([]);
    expect(r.starts.map(s => s.task ?? 'find_poses')).toEqual(['find_poses']);
    // the pose is found
    await db.delete(judgeQueue).where(eq(judgeQueue.kind, 'poses'));
    await db.update(judgeWorkers).set({ endedAt: new Date() });
    const t2 = await tick(db, r, BIG);
    expect(t2.clipStarted).toHaveLength(1);
    expect(t2.clipStarted[0]).toMatch(/^c-/);
    expect(r.starts.at(-1)).toEqual({ workerId: t2.clipStarted[0], task: 'render_clip' });
    expect(await clipCounts(db)).toEqual({ waiting: 1, running: 1 });
    // one clip waiting: one run is enough; and that run isn't counted as a pose worker
    const t3 = await tick(db, r, BIG);
    expect(t3.clipStarted).toEqual([]);
    expect(t3.starting).toBe(0);
  });
});
