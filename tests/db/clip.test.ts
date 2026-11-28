// Her lift clip's queue (3.9 step 6, piece 7): queued once when her total lands, for the lift on her card,
// moved only if a referee changes which lift that is; made only while no poses row waits; tried twice.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, events, judgeQueue, judgeWorkers, lifters, meets } from '../../web/db/schema';
import { ORDER } from '../../web/lib/meet';
import { claimClip, clipAfterLights, clipCounts, expireClipLeases, queueCardClip, queueOnRead, queueSettledClips, retryClip, settledLifters, takeClip } from '../../web/lib/card/clip-job';
import { clipCardOk } from '../../web/lib/card/best-lift';
import { createElement } from 'react';
import { forTests as drawing } from '../../web/lib/card/card-draw';
import { BestLiftCard, FORMATS, PostCard, StoryCard } from '../../web/lib/card/card-image';
import { endFrameView } from '../../web/lib/card/draw-ahead';
import { cardFor, clipState } from '../../web/lib/card/card-data';
import { opsNumbers } from '../../web/lib/ops';
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

  it('her result settles: her Story and Post are drawn ahead, behind anyone waiting, as her card link asks for them', async () => {
    process.env.CARD_DRAW_AHEAD = 'on';
    try {
      const { l, rows } = await lifter();
      expect(await queueCardClip(db, l.id, NOW)).toBe(rows[8].id);
      const card = await cardFor(db, (await db.select().from(lifters).where(eq(lifters.id, l.id)))[0]);
      const at = (el: ReturnType<typeof createElement>, size: { width: number; height: number }) => drawing.state(el, size);
      expect(['ahead', 'kept']).toContain(at(createElement(StoryCard, { v: card!.view }), FORMATS.story));
      expect(['ahead', 'kept']).toContain(at(createElement(PostCard, { v: card!.view }), FORMATS.post));
      // a bomb-out: her best lift's end frame, as the end-frame route builds it
      const b = await lifter(3);
      await db.update(attempts).set({ status: 'declared' }).where(and(eq(attempts.lifterId, b.l.id), eq(attempts.status, 'queued')));
      await db.update(attempts).set({ call: 'red', lights: ['red', 'red', 'red'] }).where(eq(attempts.id, b.rows[2].id));
      await db.update(meets).set({ closesAt: new Date(NOW.getTime() - 60_000) }).where(eq(meets.id, b.l.meetId!));
      expect(await queueCardClip(db, b.l.id, NOW)).toBe(b.rows[1].id);
      const v = await endFrameView(db, b.rows[1].id);
      expect(['ahead', 'kept']).toContain(at(createElement(BestLiftCard, { v: v! }), FORMATS.story));
    } finally { process.env.CARD_DRAW_AHEAD = 'off'; }
  }, 60_000);

  it('a referee who changes her best lift moves the waiting clip to it', async () => {
    const { l, rows } = await lifter();
    await queueCardClip(db, l.id, NOW);
    // her 155 deadlift turned red: her best is now the 145
    await db.update(attempts).set({ call: 'red', lights: ['red', 'red', 'white'] }).where(eq(attempts.id, rows[8].id));
    expect(await queueCardClip(db, l.id, NOW)).toBe(rows[7].id);
    expect((await clipRows(rows.map(r => r.id))).map(r => r.attemptId)).toEqual([rows[7].id]);
  });

  it('only while no poses row waits, then leased to the run asking', async () => {
    const saved = process.env.JUDGE_CALLBACK_SECRET;
    process.env.JUDGE_CALLBACK_SECRET = 'clip-card-test';
    try { await leased(); } finally {
      if (saved === undefined) delete process.env.JUDGE_CALLBACK_SECRET; else process.env.JUDGE_CALLBACK_SECRET = saved;
    }
  });
  async function leased() {
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
    // her Story at her card link, signed as a claimed clip's end card so it's drawn first (NerdCider, 64d5e85)
    expect(job!.card_path).toMatch(/^\/api\/card\/[\w-]{16}\.png\?f=story&clip=1&t=\d+&s=[0-9a-f]{64}$/);
    const u = new URL(job!.card_path, 'https://x');
    const token = u.pathname.match(/card\/(.+)\.png$/)![1];
    expect(clipCardOk(token, u.searchParams.get('t'), u.searchParams.get('s'), process.env.JUDGE_CALLBACK_SECRET)).toBe(true);
    expect(clipCardOk('AbCdEfGhIjKlMnOp', u.searchParams.get('t'), u.searchParams.get('s'), process.env.JUDGE_CALLBACK_SECRET)).toBe(false);
    expect(job!.judged_ms).toBeGreaterThanOrEqual(job!.start_ms);
    expect(job!.judged_ms).toBeLessThan(job!.end_ms);
    expect(await status(rows[8].id)).toBe('rendering');
    expect(await claimClip(db, store, 'c-1')).toBeNull();
  }

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

  it('item 102: after two failures she can "Try again" once; a third failure is the last, and /ops counts it', async () => {
    const { l, rows } = await lifter();
    await queueCardClip(db, l.id, NOW);
    const id = rows[8].id;
    await db.insert(judgeWorkers).values([{ workerId: 'c-6' }, { workerId: 'c-7' }, { workerId: 'c-8' }, { workerId: 'c-9' }]);
    const fail = async (w: string) => { await claimClip(db, store, w); await takeClip(db, store, { attempt_id: id, worker_id: w, ok: false, error: 'FAULT=clip set' }); };
    const state = async () => clipState((await cardFor(db, (await db.select().from(lifters).where(eq(lifters.id, l.id)))[0], NOW))!.clip);
    expect(await retryClip(db, l.id, id)).toBe(false);   // nothing has failed yet
    await fail('c-6');
    await fail('c-7');
    expect(await state()).toEqual({ ready: false, failed: 'retry' });
    const before = (await opsNumbers(db, BIG as never)).clipsFailed;
    // only her own clip
    const other = await lifter();
    expect(await retryClip(db, other.l.id, id)).toBe(false);
    expect(await retryClip(db, l.id, id)).toBe(true);
    expect(await status(id)).toBe('queued');
    expect(await state()).toEqual({ ready: false, failed: null });
    expect(await retryClip(db, l.id, id)).toBe(false);   // once
    expect(await db.select().from(events).where(and(eq(events.kind, 'clip_retried'), eq(events.attemptId, id)))).toHaveLength(1);
    await fail('c-8');
    expect(await status(id)).toBe('failed');
    expect(await state()).toEqual({ ready: false, failed: 'final' });
    expect(await retryClip(db, l.id, id)).toBe(false);
    expect((await opsNumbers(db, BIG as never)).clipsFailed).toBe(before + 1);
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

  // NerdCider at e0e2353: a total can settle with no new lights, and her clip still runs once (piece 7)
  describe('a total or bomb-out that settles with no new lights', () => {
    const CLOSED = new Date(NOW.getTime() - 60_000);
    /** her first `judged` attempts have lights; the rest she never lifted (declared) */
    async function stopped(judged: number) {
      const r = await lifter(judged);
      await db.update(attempts).set({ status: 'declared' }).where(and(eq(attempts.lifterId, r.l.id), eq(attempts.status, 'queued')));
      return r;
    }
    const close = (meetId: string, deadline?: Date) =>
      db.update(meets).set({ closesAt: CLOSED, ...(deadline ? { clipDeadlineAt: deadline } : {}) }).where(eq(meets.id, meetId));

    it('the platform closes before her ninth: the sweep queues her best lift, once', async () => {
      const { l, rows } = await stopped(7);
      expect(await queueSettledClips(db, NOW)).not.toContain(rows[6].id);   // still open: she's lifting
      await close(rows[0].meetId);
      expect(await queueSettledClips(db, NOW)).toContain(rows[6].id);       // 135 deadlift, her heaviest bar
      expect(await status(rows[6].id)).toBe('queued');
      expect(await queueSettledClips(db, NOW)).not.toContain(rows[6].id);
      expect(await queueCardClip(db, l.id, NOW)).toBeNull();
      expect(await clipRows(rows.map(r => r.id))).toHaveLength(1);
    });

    it('her last attempt is voided at the clip deadline: she gets her clip', async () => {
      const { rows } = await lifter(8);
      await db.update(attempts).set({ status: 'uploading' }).where(eq(attempts.id, rows[8].id));
      await close(rows[0].meetId, CLOSED);
      expect(await queueSettledClips(db, NOW)).toContain(rows[7].id);       // the 145 deadlift
      expect((await db.select().from(attempts).where(eq(attempts.id, rows[8].id)))[0]).toMatchObject({ status: 'void', voidReason: 'upload_late' });
    });

    it('not while a clip is still sending before the deadline, or a close call waits', async () => {
      const sending = await lifter(8);
      await db.update(attempts).set({ status: 'uploading' }).where(eq(attempts.id, sending.rows[8].id));
      await close(sending.rows[0].meetId, new Date(NOW.getTime() + 60_000));
      const ref = await stopped(7);
      await db.update(attempts).set({ status: 'close_call', call: 'close' }).where(eq(attempts.id, ref.rows[6].id));
      await close(ref.rows[0].meetId);
      const q = await queueSettledClips(db, NOW);
      expect(q.filter(id => [...sending.rows, ...ref.rows].some(r => r.id === id))).toEqual([]);
    });

    it('a bomb-out with a good attempt, closed early: her best lift gets its clip; with none, nothing', async () => {
      const { rows } = await stopped(7);
      await db.update(attempts).set({ call: 'red', lights: ['red', 'red', 'red'] }).where(sql`${attempts.id} in ${rows.slice(0, 3).map(r => r.id)}`);
      await close(rows[0].meetId);
      expect(await queueSettledClips(db, NOW)).toContain(rows[6].id);
      const none = await stopped(3);
      await db.update(attempts).set({ call: 'red', lights: ['red', 'red', 'red'] }).where(sql`${attempts.id} in ${none.rows.slice(0, 3).map(r => r.id)}`);
      await close(none.rows[0].meetId);
      expect((await queueSettledClips(db, NOW)).filter(id => none.rows.some(r => r.id === id))).toEqual([]);
      expect(await clipRows(none.rows.map(r => r.id))).toHaveLength(0);
      // and the sweep doesn't pick her at all, so 200 a minute can't fill up with her (NerdCider, 64d5e85)
      expect(await settledLifters(db, NOW)).not.toContain(none.l.id);
    });

    it('a bomb-out whose last attempt is voided at the clip deadline: her best lift gets its clip', async () => {
      const { rows } = await lifter(8);
      await db.update(attempts).set({ call: 'red', lights: ['red', 'red', 'red'] }).where(sql`${attempts.id} in ${rows.slice(0, 3).map(r => r.id)}`);
      await db.update(attempts).set({ status: 'uploading' }).where(eq(attempts.id, rows[8].id));
      await close(rows[0].meetId, CLOSED);
      expect(await queueSettledClips(db, NOW)).toContain(rows[7].id);       // the 145 deadlift, her best lift
      expect(await status(rows[7].id)).toBe('queued');
      expect(await clipRows(rows.map(r => r.id))).toHaveLength(1);
    });

    it('her card queues it on read, if the sweep hasn\'t yet', async () => {
      const { l, rows } = await stopped(7);
      await close(rows[0].meetId);
      const [row] = await db.select().from(lifters).where(eq(lifters.id, l.id));
      const card = (await cardFor(db, row, NOW))!;
      expect(card.clip).toMatchObject({ attemptId: rows[6].id, status: null });
      expect(await queueOnRead(db, l.id, card.clip!.attemptId, card.clip!.status, NOW)).toBe(true);
      expect(await status(rows[6].id)).toBe('queued');
      expect(clipState((await cardFor(db, row, NOW))!.clip)).toEqual({ ready: false, failed: null });
      expect(await queueOnRead(db, l.id, rows[6].id, 'queued', NOW)).toBe(false);
    });
  });
});
