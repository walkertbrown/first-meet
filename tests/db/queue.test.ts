// The judge queue on Postgres (plan 3.9; piece 8's done-whens).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { connect, type Db } from '../../web/db';
import { attempts, events, judgeQueue, judgeWorkers } from '../../web/db/schema';
import { MAX_CLIP_BYTES, claimNext, clipSecondsOf, expireLeases, markUploaded, takePoses, workerDone, workerFailed } from '../../web/lib/queue';
import { judgeClip, type Frame } from '../../web/lib/judge';
import { freshDb, MemStore, seed, URL_ } from './setup';

type Raw = { w: number; h: number; duration: number; frames: Frame[] };
const racked: Raw = JSON.parse(readFileSync(join(__dirname, '../clips/poses/racked-squats-side.json'), 'utf8'));
const v0 = judgeClip(racked.frames, racked, 'squat');
const CT = { loaded: 0, squat: v0.windowStart!, rack: v0.result!.reps[0].endMs! + 600 };

describe.skipIf(!URL_)('the judge queue', () => {
  let db: Db, drop: () => Promise<void>, schema: string;
  const store = new MemStore();
  beforeAll(async () => ({ db, drop, schema } = await freshDb()));
  afterAll(async () => drop?.());

  const worker = async (id: string) => { await db.insert(judgeWorkers).values({ workerId: id }).onConflictDoNothing(); return id; };

  it('upload → claim → pass 1 → pass 2 → white lights, with the commit and judged frame saved', async () => {
    const { attempts: [id] } = await seed(db, store, 1);
    const up = await markUploaded(db, store, id, CT);
    expect(up.status).toBe(200);
    const [q] = await db.select().from(judgeQueue).where(eq(judgeQueue.attemptId, id));
    expect(q.kind).toBe('poses');
    const w = await worker('w-one');
    const job = await claimNext(db, store, w);
    expect(job).toMatchObject({ attempt_id: id, command_times: CT, lift: 'squat' });
    expect(job!.video_url).toContain('signed');
    const [judging] = await db.select().from(attempts).where(eq(attempts.id, id));
    expect(judging.status).toBe('judging');

    const dims = { w: racked.w, h: racked.h, duration: racked.duration };
    const p1 = racked.frames.filter((_, i) => i % 3 === 0);
    const r1 = await takePoses(db, store, { attempt_id: id, worker_id: w, pass: 1, ...dims, frames: p1 });
    expect(r1.status).toBe(200);
    if (r1.status !== 200) return;
    expect(r1.windows!.length).toBeGreaterThan(0);
    const inWin = racked.frames.filter(f => r1.windows!.some(([a, b]) => f.t >= a && f.t <= b));
    const r2 = await takePoses(db, store, { attempt_id: id, worker_id: w, pass: 2, ...dims, frames: inWin, commit: 'abc1234', secs: 3.2 });
    expect(r2).toMatchObject({ status: 200, call: 'white' });
    const [a] = await db.select().from(attempts).where(eq(attempts.id, id));
    expect(a).toMatchObject({ status: 'judged', call: 'white', lights: ['white', 'white', 'white'], posesKey: `poses/${id}.json` });
    expect(a.judgedFrameMs).toBe(v0.result!.reps[0].judgedFrameMs);
    expect(a.measures).toMatchObject({ commit: 'abc1234', judged_frame_ms: a.judgedFrameMs });
    expect((a.measures as { depth: number }).depth).toBeGreaterThan(0.05);
    expect(store.objects.has(`poses/${id}.json`)).toBe(true);
    expect(await db.select().from(judgeQueue).where(eq(judgeQueue.attemptId, id))).toHaveLength(0);
    const [wk] = await db.select().from(judgeWorkers).where(eq(judgeWorkers.workerId, w));
    expect(wk.attemptsDone).toBe(1);
    const [ev] = await db.select().from(events).where(sql`${events.kind} = 'judged' and ${events.attemptId} = ${id}`);
    expect(ev.detail).toMatchObject({ call: 'white', pose_secs: 3.2, commit: 'abc1234' });
  });

  it('bad command_times: a close call, never a white', async () => {
    const { attempts: [id] } = await seed(db, store, 1);
    await markUploaded(db, store, id, { loaded: 5000, squat: 1000, rack: 900000 });
    const w = await worker('w-bad');
    await claimNext(db, store, w);
    const dims = { w: racked.w, h: racked.h, duration: racked.duration };
    await takePoses(db, store, { attempt_id: id, worker_id: w, pass: 1, ...dims, frames: racked.frames });
    await takePoses(db, store, { attempt_id: id, worker_id: w, pass: 2, ...dims, frames: racked.frames });
    const [a] = await db.select().from(attempts).where(eq(attempts.id, id));
    expect(a).toMatchObject({ status: 'close_call', call: 'close', reason: 'command_times', lights: null });
  });

  it('a command time past the longest clip: a close call at once, with no judge run and no long lease', async () => {
    const { attempts: [id] } = await seed(db, store, 1);
    const up = await markUploaded(db, store, id, { loaded: 0, squat: 1800, rack: 1e12 });
    expect(up.status).toBe(200);
    const [a] = await db.select().from(attempts).where(eq(attempts.id, id));
    expect(a).toMatchObject({ status: 'close_call', call: 'close', reason: 'command_times', lights: null, measures: { command_times: 'outside_clip' } });
    expect(await db.select().from(judgeQueue).where(eq(judgeQueue.attemptId, id))).toHaveLength(0);
    // and the lease never runs past the longest clip, whatever the times say
    expect(clipSecondsOf({ loaded: 0, squat: 1e12 })).toBe(91.5);
    expect(clipSecondsOf({ loaded: 0, squat: 1800, rack: 5200 })).toBeCloseTo(6.7);
  });

  it('a clip past the size bound is refused, and the attempt is hers again', async () => {
    const { attempts: [id] } = await seed(db, store, 1);
    const [a] = await db.select().from(attempts).where(eq(attempts.id, id));
    store.bytes.set(a.videoKey!, MAX_CLIP_BYTES + 1);
    expect(await markUploaded(db, store, id, CT)).toMatchObject({ status: 413 });
    const [back] = await db.select().from(attempts).where(eq(attempts.id, id));
    expect(back).toMatchObject({ status: 'declared', videoKey: null });
    expect(await db.select().from(judgeQueue).where(eq(judgeQueue.attemptId, id))).toHaveLength(0);
  });

  it('one bad clip: only that attempt becomes judge_unavailable, and only its worker can say so', async () => {
    await db.delete(judgeQueue);
    const { attempts: [bad, good] } = await seed(db, store, 2);
    await markUploaded(db, store, bad, CT);
    await markUploaded(db, store, good, CT);
    const w = await worker('w-bad-clip');
    expect((await claimNext(db, store, w))!.attempt_id).toBe(bad);
    expect(await workerFailed(db, bad, 'w-someone-else', 'no')).toBe(false);
    expect(await workerFailed(db, bad, w, 'InvalidDataError: no frames')).toBe(true);
    const [cc] = await db.select().from(attempts).where(eq(attempts.id, bad));
    expect(cc).toMatchObject({ status: 'close_call', call: 'close', reason: 'judge_unavailable', lights: null });
    const [ev] = await db.select().from(events).where(sql`${events.kind} = 'close_call' and ${events.attemptId} = ${bad}`);
    expect(ev.detail).toMatchObject({ reason: 'judge_unavailable', why: 'InvalidDataError: no frames', worker_id: w });
    // saying it twice changes nothing, and the same worker goes on to the next
    expect(await workerFailed(db, bad, w, 'again')).toBe(false);
    expect((await claimNext(db, store, w))!.attempt_id).toBe(good);
    const [wk] = await db.select().from(judgeWorkers).where(eq(judgeWorkers.workerId, w));
    expect(wk.endedAt).toBeNull();
  });

  it('an upload not in R2 is refused, and nothing is queued', async () => {
    const { attempts: [id] } = await seed(db, store, 1);
    const [a] = await db.select().from(attempts).where(eq(attempts.id, id));
    store.objects.delete(a.videoKey!);
    expect((await markUploaded(db, store, id, CT)).status).toBe(409);
    expect(await db.select().from(judgeQueue).where(eq(judgeQueue.attemptId, id))).toHaveLength(0);
  });

  it('two workers never get the same attempt: 10 workers asking at once', async () => {
    await db.delete(judgeQueue);
    const { attempts: ids } = await seed(db, store, 6);
    for (const id of ids) await markUploaded(db, store, id, CT);
    // ten separate connections, all asking at the same moment
    const conns = await Promise.all(Array.from({ length: 10 }, () => connect(URL_!, { schema, max: 1 })));
    const ws = await Promise.all(Array.from({ length: 10 }, (_, i) => worker(`w-race-${i}`)));
    const got = await Promise.all(conns.map((c, i) => claimNext(c, store, ws[i])));
    await Promise.all(conns.map(c => c.$client.end()));
    const claimed = got.filter(Boolean).map(j => j!.attempt_id);
    expect(claimed.sort()).toEqual([...ids].sort());
    expect(new Set(claimed).size).toBe(6);
    expect(got.filter(j => j === null)).toHaveLength(4);
    const rows = await db.select().from(judgeQueue);
    expect(new Set(rows.map(r => r.workerId)).size).toBe(6);
  });

  it('nothing waiting: 204, and the worker is marked idle', async () => {
    await db.delete(judgeQueue);
    const w = await worker('w-idle');
    expect(await claimNext(db, store, w)).toBeNull();
    const [wk] = await db.select().from(judgeWorkers).where(eq(judgeWorkers.workerId, w));
    expect(wk.idleAt).not.toBeNull();
    expect(wk.lastSeenAt).not.toBeNull();
  });

  it('a cancelled worker: put back once when its lease runs out, a close call the second time', async () => {
    await db.delete(judgeQueue);
    const { attempts: [id] } = await seed(db, store, 1);
    await markUploaded(db, store, id, CT);
    const w1 = await worker('w-gone-1');
    expect((await claimNext(db, store, w1))!.attempt_id).toBe(id);
    const [q] = await db.select().from(judgeQueue).where(eq(judgeQueue.attemptId, id));
    // lease = now + 2 minutes + the clip's length
    const leaseS = (new Date(q.leasedUntil!).getTime() - Date.now()) / 1000;
    expect(leaseS).toBeGreaterThan(120 + q.clipSeconds - 5);
    expect(leaseS).toBeLessThan(120 + q.clipSeconds + 5);

    await db.update(judgeQueue).set({ leasedUntil: sql`now() - interval '1 second'` });
    expect(await expireLeases(db)).toEqual({ requeued: [id], closeCalls: [] });
    const [back] = await db.select().from(attempts).where(eq(attempts.id, id));
    expect(back.status).toBe('queued');
    const [gone] = await db.select().from(judgeWorkers).where(eq(judgeWorkers.workerId, w1));
    expect(gone.endedAt).not.toBeNull();

    // the old worker's late points are dropped
    const late = await takePoses(db, store, { attempt_id: id, worker_id: w1, pass: 1, w: 1, h: 1, duration: 1, frames: [] });
    expect(late.status).toBe(409);

    const w2 = await worker('w-gone-2');
    expect((await claimNext(db, store, w2))!.attempt_id).toBe(id);
    await db.update(judgeQueue).set({ leasedUntil: sql`now() - interval '1 second'` });
    expect(await expireLeases(db)).toEqual({ requeued: [], closeCalls: [id] });
    const [cc] = await db.select().from(attempts).where(eq(attempts.id, id));
    expect(cc).toMatchObject({ status: 'close_call', reason: 'judge_unavailable' });
  });

  it('worker-done ends the worker', async () => {
    const w = await worker('w-done');
    await workerDone(db, w, 'abc1234');
    const [wk] = await db.select().from(judgeWorkers).where(eq(judgeWorkers.workerId, w));
    expect(wk.endedAt).not.toBeNull();
    expect(wk.commit).toBe('abc1234');
  });
});
