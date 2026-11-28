// Item 119 (held, ITEM_119=on): her clip is made again when its end card changes, 60 s after the last change;
// the old clip stays ready meanwhile; two tries, then /ops; one sweep at "Make the board final"; the line on
// her Clip segment if she had sent the old one; and staging's "Give the test lifter good bench and deadlift
// attempts now".
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, events, judgeQueue, judgeWorkers, lifters, meets } from '../../web/db/schema';
import { ORDER } from '../../web/lib/meet';
import { claimClip, clipAfterLights, clipCounts, queueCardClip, takeClip } from '../../web/lib/card/clip-job';
import { cardFor } from '../../web/lib/card/card-data';
import { endCardHash } from '../../web/lib/card/card-hash';
import { failedRemakes, markClipSent, newTotalLine, REMAKE_AFTER_MS, remakeAtFinal, retryRemake } from '../../web/lib/card/clip-remake';
import { GOOD_PRESSES_REFUSED, MEET_WEEK_ACCOUNTS, TEST_MEET_SLUG, testGoodPresses } from '../../web/lib/test-signin';
import { keys } from '../../web/lib/r2';
import { changeLights } from '../../web/lib/referee';
import { freshDb, MemStore, URL_ } from './setup';

const WEIGHTS = [95, 105, 115, 65, 70, 75, 135, 145, 155];
const CT = { loaded: 0, squat: 2000, rack: 6000 };

class Store extends MemStore {
  async signedPut(key: string) { return `https://r2.test/${key}?put`; }
}

describe.skipIf(!URL_)('item 119: her clip made again when her end card changes', () => {
  let db: Db, drop: () => Promise<void>;
  const store = new Store();
  let saved: string | undefined;
  let w = 0;
  beforeAll(async () => { ({ db, drop } = await freshDb(5)); });
  afterAll(async () => drop?.());
  beforeEach(async () => { saved = process.env.ITEM_119; process.env.ITEM_119 = 'on'; await db.delete(judgeQueue); });
  afterEach(() => { if (saved === undefined) delete process.env.ITEM_119; else process.env.ITEM_119 = saved; });

  async function lifter() {
    const [m] = await db.insert(meets).values({
      slug: `m-${randomBytes(4).toString('hex')}`, name: 'Winter 2027', kind: 'real', status: 'open',
      opensAt: new Date(Date.now() - 3_600_000), closesAt: new Date(Date.now() + 86_400_000),
    }).returning();
    const [l] = await db.insert(lifters).values({ cardName: `Diane ${randomBytes(2).toString('hex')}`, division: 'barbell', meetId: m.id }).returning();
    const rows = [];
    for (let k = 0; k < 9; k++) {
      const [a] = await db.insert(attempts).values({
        lifterId: l.id, meetId: m.id, lift: ORDER[k].lift, number: ORDER[k].number, weight: WEIGHTS[k],
        status: 'judged', call: 'white', lights: ['white', 'white', 'white'], videoKey: `videos/${l.id}/${k}.webm`, commandTimes: CT,
      }).returning();
      rows.push(a);
    }
    return { l, m, rows, clip: rows[8].id };
  }
  const worker = async () => { const id = `c-r${++w}`; await db.insert(judgeWorkers).values({ workerId: id }); return id; };
  /** One clip run: claims whatever is due, and makes it (or fails it). */
  async function run(ok = true) {
    const id = await worker();
    const job = await claimClip(db, store, id);
    if (!job) return null;
    if (ok) store.objects.set(keys.clip(job.attempt_id), 'mp4');
    else store.objects.delete(keys.clip(job.attempt_id));
    await takeClip(db, store, { attempt_id: job.attempt_id, worker_id: id, ok, error: ok ? undefined : 'FAULT=clip set' });
    return job.attempt_id;
  }
  /** Her clip is made, as the queue makes it. */
  async function made() {
    const x = await lifter();
    await queueCardClip(db, x.l.id);
    expect(await run()).toBe(x.clip);
    return x;
  }
  const att = async (id: string) => (await db.select().from(attempts).where(eq(attempts.id, id)))[0];
  const queued = async (id: string) => (await db.select().from(judgeQueue).where(and(eq(judgeQueue.attemptId, id), eq(judgeQueue.kind, 'clip'))))[0] ?? null;
  const hashNow = async (lifterId: string) => {
    const [l] = await db.select().from(lifters).where(eq(lifters.id, lifterId));
    return endCardHash((await cardFor(db, l))!.view);
  };
  /** A referee's change: the lights on one attempt, then what follows any lights. */
  async function lights(id: string, call: 'white' | 'red') {
    await db.update(attempts).set({ call, lights: call === 'red' ? ['red', 'red', 'white'] : ['white', 'white', 'white'] }).where(eq(attempts.id, id));
    await clipAfterLights(db, id);
  }
  const due = (id: string) => db.update(judgeQueue).set({ nextTryAt: new Date(Date.now() - 1000) }).where(eq(judgeQueue.attemptId, id));

  it('the made clip keeps the hash of the end card it ends on, switch on or off', async () => {
    process.env.ITEM_119 = 'off';
    const { l, clip } = await made();
    const a = await att(clip);
    expect(a.clipStatus).toBe('ready');
    expect(a.clipCardHash).toBe(await hashNow(l.id));
    // off: a change queues nothing
    const rows = await db.select().from(attempts).where(eq(attempts.lifterId, l.id));
    await lights(rows.find(r => r.lift === 'bench' && r.number === 3)!.id, 'red');
    expect(await queued(clip)).toBeNull();
  });

  it('a change queues it again 60 s on; a run of changes makes one run; the old clip stays ready meanwhile', async () => {
    const { rows, clip } = await made();
    const t0 = Date.now();
    await lights(rows[5].id, 'red');    // bench 3: her total drops 10
    const q1 = await queued(clip);
    expect(q1).toMatchObject({ remake: true, requeued: false, workerId: null });
    expect(q1!.nextTryAt.getTime() - t0).toBeGreaterThanOrEqual(REMAKE_AFTER_MS - 1000);
    expect((await att(clip)).clipStatus).toBe('ready');
    // not due: the dispatcher starts no run for it, and no run takes it
    expect((await clipCounts(db)).waiting).toBe(0);
    expect(await claimClip(db, store, await worker())).toBeNull();
    // a second change pushes the one run back
    await new Promise(r => setTimeout(r, 20));
    await lights(rows[4].id, 'red');
    const q2 = await queued(clip);
    expect(q2!.nextTryAt.getTime()).toBeGreaterThan(q1!.nextTryAt.getTime());
    expect(await db.select().from(judgeQueue).where(eq(judgeQueue.attemptId, clip))).toHaveLength(1);
  });

  it('changes put back before it runs: no run', async () => {
    const { rows, clip } = await made();
    await lights(rows[5].id, 'red');
    expect(await queued(clip)).not.toBeNull();
    await lights(rows[5].id, 'white');
    expect(await queued(clip)).toBeNull();
  });

  it('made again: still ready while it is, then the new card, at the same key, and no more runs', async () => {
    const { l, rows, clip } = await made();
    await lights(rows[5].id, 'red');
    await due(clip);
    const id = await worker();
    const job = await claimClip(db, store, id);
    expect(job?.attempt_id).toBe(clip);
    expect((await att(clip)).clipStatus).toBe('ready');
    expect((await queued(clip))!.cardHash).toBe(await hashNow(l.id));
    store.objects.set(keys.clip(clip), 'mp4 v2');
    await takeClip(db, store, { attempt_id: clip, worker_id: id, ok: true });
    const a = await att(clip);
    expect(a).toMatchObject({ clipStatus: 'ready', clipKey: keys.clip(clip), clipCardHash: await hashNow(l.id), clipRemakeFailed: false });
    expect(await queued(clip)).toBeNull();
    expect(await db.select().from(events).where(and(eq(events.kind, 'clip_rendered'), eq(events.attemptId, clip)))).toHaveLength(2);
  });

  it('her card changes while it is being made: one more run after the minute', async () => {
    const { rows, clip } = await made();
    await lights(rows[5].id, 'red');
    await due(clip);
    const id = await worker();
    await claimClip(db, store, id);
    await lights(rows[4].id, 'red');                    // a referee, mid-run: the run keeps its lease
    expect((await queued(clip))!.workerId).toBe(id);
    store.objects.set(keys.clip(clip), 'mp4 v2');
    await takeClip(db, store, { attempt_id: clip, worker_id: id, ok: true });
    expect(await queued(clip)).toMatchObject({ remake: true, workerId: null });
  });

  it('a total only: a bomb-out has no card hash and is never made again', async () => {
    const { l, rows, clip } = await made();
    // every squat red and the platform closed: a bomb-out
    for (const r of rows.slice(0, 3)) await db.update(attempts).set({ call: 'red', lights: ['red', 'red', 'red'] }).where(eq(attempts.id, r.id));
    await db.update(meets).set({ closesAt: new Date(Date.now() - 60_000) }).where(eq(meets.id, l.meetId!));
    await clipAfterLights(db, rows[0].id);
    expect(await queued(clip)).toBeNull();
  });

  it('a remake that fails twice: she keeps the old clip, /ops names it, "Try again" gives it one more try', async () => {
    const { l, rows, clip } = await made();
    await lights(rows[5].id, 'red');
    await due(clip);
    expect(await run(false)).toBe(clip);
    expect(await queued(clip)).toMatchObject({ remake: true, requeued: true });
    expect((await att(clip)).clipStatus).toBe('ready');
    expect(await run(false)).toBe(clip);
    expect(await queued(clip)).toBeNull();
    expect(await att(clip)).toMatchObject({ clipStatus: 'ready', clipRemakeFailed: true });
    expect((await failedRemakes(db)).find(f => f.attemptId === clip)).toMatchObject({ lifterId: l.id, name: l.cardName });
    // the line isn't shown: she had sent it, but the clip she has is still the old one
    await markClipSent(db, l.id, clip);
    const a = await att(clip);
    expect(newTotalLine({ status: a.clipStatus, cardHash: a.clipCardHash, sentHash: a.clipSentHash })).toBe(false);
    // "Try again": one try
    expect(await retryRemake(db, clip)).toBe(true);
    expect(await queued(clip)).toMatchObject({ remake: true, requeued: true });
    expect(await run(false)).toBe(clip);
    expect(await queued(clip)).toBeNull();
    // made at last: off /ops
    expect(await retryRemake(db, clip)).toBe(true);
    expect(await run()).toBe(clip);
    expect((await att(clip)).clipRemakeFailed).toBe(false);
    expect((await failedRemakes(db)).find(f => f.attemptId === clip)).toBeUndefined();
  });

  it('"Make the board final" sweeps once: a differing clip now, a failed one once more, the rest never', async () => {
    const a = await made();
    const b = await lifter();
    await db.update(lifters).set({ meetId: a.m.id }).where(eq(lifters.id, b.l.id));
    await db.update(attempts).set({ meetId: a.m.id }).where(eq(attempts.lifterId, b.l.id));
    await queueCardClip(db, b.l.id);
    expect(await run()).toBe(b.clip);
    // a spot check's red on a's bench, written straight to her lights with no queue (as the board's sweep sees it)
    await db.update(attempts).set({ call: 'red', lights: ['red', 'red', 'red'] }).where(eq(attempts.id, a.rows[5].id));
    const now = new Date();
    expect(await remakeAtFinal(db, a.m.id, now)).toEqual([a.clip]);
    expect((await queued(a.clip))!.nextTryAt.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(await queued(b.clip)).toBeNull();
    // fails twice, then the sweep gives it one more try
    expect(await run(false)).toBe(a.clip);
    expect(await run(false)).toBe(a.clip);
    expect(await remakeAtFinal(db, a.m.id)).toEqual([a.clip]);
    expect(await queued(a.clip)).toMatchObject({ requeued: true });
    // switch off: no sweep
    await db.delete(judgeQueue);
    process.env.ITEM_119 = 'off';
    expect(await remakeAtFinal(db, a.m.id)).toEqual([]);
  });

  it('a clip made before item 119 (no hash) is left as it is', async () => {
    const { rows, clip } = await made();
    await db.update(attempts).set({ clipCardHash: null }).where(eq(attempts.id, clip));
    await lights(rows[5].id, 'red');
    expect(await queued(clip)).toBeNull();
  });

  it('her line: only if she sent the old clip, until she sends the new one; never with the switch off', async () => {
    const line = async (id: string, on = true) => {
      const a = await att(id);
      return newTotalLine({ status: a.clipStatus, cardHash: a.clipCardHash, sentHash: a.clipSentHash }, on);
    };
    // she never sent it: no line
    const quiet = await made();
    await lights(quiet.rows[5].id, 'red');
    await due(quiet.clip);
    await run();
    expect(await line(quiet.clip)).toBe(false);
    // she sent it (Share or Save to my phone), then it was made again
    const { l, rows, clip } = await made();
    await markClipSent(db, l.id, clip);
    expect(await line(clip)).toBe(false);
    await lights(rows[5].id, 'red');
    expect(await line(clip)).toBe(false);        // being made: the old clip and its lines, as they were
    await due(clip);
    await run();
    expect(await line(clip)).toBe(true);
    expect(await line(clip, false)).toBe(false);
    // only her own clip
    const other = await lifter();
    await markClipSent(db, other.l.id, clip);
    expect(await line(clip)).toBe(true);
    await markClipSent(db, l.id, clip);
    expect(await line(clip)).toBe(false);
  });

  describe("staging's \"Give the test lifter good bench and deadlift attempts now\"", () => {
    async function testLifter() {
      let [meet] = await db.select().from(meets).where(eq(meets.slug, TEST_MEET_SLUG));
      meet ??= (await db.insert(meets).values({ slug: TEST_MEET_SLUG, name: 'Test meet', kind: 'test', status: 'open' }).returning())[0];
      let [l] = await db.select().from(lifters).where(eq(lifters.email, MEET_WEEK_ACCOUNTS.meetweek.email));
      l ??= (await db.insert(lifters).values({ cardName: 'Test lifter', email: MEET_WEEK_ACCOUNTS.meetweek.email, division: 'barbell', units: 'kg', meetId: meet.id }).returning())[0];
      return { meet, l };
    }

    it('refused with an /ops line until she has a good squat', async () => {
      await testLifter();
      expect(await testGoodPresses(db)).toBe('no-squat');
      const ev = await db.select().from(events).where(eq(events.kind, 'error'));
      expect(ev.some(e => (e.detail as { message?: string } | null)?.message === GOOD_PRESSES_REFUSED)).toBe(true);
    });

    it('six whites at about 40, 45 and 50% of her heaviest good squat; her total and clip follow', async () => {
      const { meet, l } = await testLifter();
      await db.insert(attempts).values([
        { lifterId: l.id, meetId: meet.id, lift: 'squat', number: 1, weight: 100, status: 'judged', call: 'white', lights: ['white', 'white', 'white'], videoKey: 'videos/x/squat1.webm', commandTimes: CT },
        { lifterId: l.id, meetId: meet.id, lift: 'squat', number: 2, weight: 110, status: 'judged', call: 'red', lights: ['red', 'red', 'red'], videoKey: 'videos/x/squat2.webm', commandTimes: CT },
      ]);
      expect(await testGoodPresses(db)).toBe('ok');
      const mine = await db.select().from(attempts).where(eq(attempts.lifterId, l.id));
      const of = (lift: string) => mine.filter(a => a.lift === lift).sort((x, y) => x.number - y.number).map(a => [Number(a.weight), a.call]);
      expect(of('bench')).toEqual([[40, 'white'], [45, 'white'], [50, 'white']]);
      expect(of('deadlift')).toEqual([[40, 'white'], [45, 'white'], [50, 'white']]);
      expect(of('squat')).toEqual([[100, 'white'], [110, 'red']]);
      // pressed again: the same six, not twelve
      expect(await testGoodPresses(db)).toBe('ok');
      expect((await db.select().from(attempts).where(eq(attempts.lifterId, l.id))).length).toBe(8);
      // "Close the test meet's platform now", beside it: her squats 2 and 3 not taken, she totals
      const [fresh] = await db.select().from(lifters).where(eq(lifters.id, l.id));
      expect(await cardFor(db, fresh)).toBeNull();
      await db.update(meets).set({ closesAt: new Date(Date.now() - 1000) }).where(eq(meets.id, meet.id));
      expect((await cardFor(db, fresh))?.view.totalValue).toBe(200);
      // her clip, made; then the test referee turns a bench light red, as the staging run does: one run, a minute on
      await queueCardClip(db, l.id);
      const clip = await run();
      expect(clip).toBeTruthy();
      const bench3 = (await db.select().from(attempts).where(and(eq(attempts.lifterId, l.id), eq(attempts.lift, 'bench'), eq(attempts.number, 3))))[0];
      const [ref] = await db.insert(lifters).values({ cardName: 'Test referee', division: 'barbell', isReferee: true }).returning();
      expect((await changeLights(db, bench3.id, ref.id, { lights: ['red', 'white', 'red'], reasons: ['no_lockout', null, 'no_lockout'] })).status).toBe(200);
      await clipAfterLights(db, bench3.id);
      expect(await queued(clip!)).toMatchObject({ remake: true });
      expect((await att(clip!)).clipStatus).toBe('ready');
    });
  });
});
