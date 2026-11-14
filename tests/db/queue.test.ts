// The judge queue on Postgres (plan 3.9; piece 8's done-whens).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { connect, type Db } from '../../web/db';
import { attempts, events, judgeQueue, judgeWorkers } from '../../web/db/schema';
import { MAX_CLIP_BYTES, claimNext, clipSecondsOf, expireLeases, markUploaded, parseBar, takeBar, takePoses, workerDone, workerFailed } from '../../web/lib/queue';
import { BarCaller, judgeClip, type BarPoint, type Frame } from '../../web/lib/judge';
import { judgedFrame } from '../../web/lib/attempt-state';
import samples from '../../content/samples/samples.json';
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

  describe('a Barbell bench (3.4b): every one to a referee, followed from her tap', () => {
    const tr = JSON.parse(readFileSync(join(__dirname, '../bench-commands/data/traces/KrDo.json'), 'utf8')) as
      { w: number; h: number; racked: boolean; mark: { x: number; y: number }; pts: BarPoint[] };
    const tap = { x: tr.mark.x, y: tr.mark.y, size: 0.08 };
    const phone: Record<string, unknown> = { loaded: tr.pts[0][0], plate_tap: tap };
    const c = new BarCaller(tr.mark, tr, undefined, tr.racked);
    for (const [t, x, y, s] of tr.pts) { const r = c.feed(t, x, y, s); if (r) phone[r.cmd] = t; }
    const BENCH_CT = phone as Record<string, number>;
    const dims = { w: tr.w, h: tr.h, duration: tr.pts.at(-1)![0] / 1000 + 1 };

    it('the job says to follow the bar; its path is saved and measured, and it goes to a referee', async () => {
      await db.delete(judgeQueue);
      const { attempts: [id] } = await seed(db, store, 1, 'bench');
      expect((await markUploaded(db, store, id, BENCH_CT)).status).toBe(200);
      const w = await worker('w-bench');
      const job = await claimNext(db, store, w);
      expect(job).toMatchObject({ attempt_id: id, lift: 'bench', track: 'bar', plate_tap: tap });
      const post = parseBar({ attempt_id: id, worker_id: w, ...dims, path: tr.pts, commit: 'abc1234', secs: 1.5 });
      expect(post).not.toBeNull();
      expect(await takeBar(db, store, { ...post!, worker_id: 'w-other' })).toMatchObject({ status: 409 });
      expect(await takeBar(db, store, post!)).toEqual({ status: 200, call: 'close' });
      const [a] = await db.select().from(attempts).where(eq(attempts.id, id));
      expect(a).toMatchObject({ status: 'close_call', call: 'close', reason: 'bench_referee', lights: null, barKey: `bar/${id}.json`, shadowLights: ['white', 'white', 'white'] });
      expect(a.measures).toMatchObject({ press_while_sinking: false, lost_share: 0, lost_after_start: false, shadow: { light: 'white' }, commit: 'abc1234' });
      expect((a.measures as { pause_s: number }).pause_s).toBeGreaterThan(0.5);
      expect(store.objects.get(`bar/${id}.json`)).toMatchObject({ tap, path: tr.pts });
      expect(await db.select().from(judgeQueue).where(eq(judgeQueue.attemptId, id))).toHaveLength(0);
      const [ev] = await db.select().from(events).where(sql`${events.kind} = 'close_call' and ${events.attemptId} = ${id}`);
      expect(ev.detail).toMatchObject({ reason: 'bench_referee', shadow: { light: 'white' }, bar_secs: 1.5 });
      // posting it again changes nothing
      expect(await takeBar(db, store, post!)).toMatchObject({ status: 404 });
    });

    it('broken command times: still to a referee, as a command_times close call', async () => {
      await db.delete(judgeQueue);
      const { attempts: [id] } = await seed(db, store, 1, 'bench');
      await markUploaded(db, store, id, { ...BENCH_CT, press: BENCH_CT.start - 100 });
      const w = await worker('w-bench-bad');
      await claimNext(db, store, w);
      await takeBar(db, store, { attempt_id: id, worker_id: w, ...dims, path: tr.pts });
      const [a] = await db.select().from(attempts).where(eq(attempts.id, id));
      expect(a).toMatchObject({ status: 'close_call', reason: 'command_times', shadowLights: null, measures: { command_times: 'out_of_order' } });
    });

    it('no plate_tap: nothing to follow, so straight to a referee with no worker run', async () => {
      const { attempts: [id] } = await seed(db, store, 1, 'bench');
      const noTap: Record<string, unknown> = { ...BENCH_CT };
      delete noTap.plate_tap;
      await markUploaded(db, store, id, noTap);
      const [a] = await db.select().from(attempts).where(eq(attempts.id, id));
      expect(a).toMatchObject({ status: 'close_call', call: 'close', reason: 'bench_referee', measures: { plate_tap: 'missing' } });
      expect(await db.select().from(judgeQueue).where(eq(judgeQueue.attemptId, id))).toHaveLength(0);
    });

    it("a worker that ran poses on it anyway never gives it the camera's light", async () => {
      await db.delete(judgeQueue);
      const { attempts: [id] } = await seed(db, store, 1, 'bench');
      await markUploaded(db, store, id, { loaded: 0, start: 1000, press: 3000, rack: 5000, plate_tap: tap } as unknown as Record<string, number>);
      const w = await worker('w-old');
      await claimNext(db, store, w);
      const d = { w: racked.w, h: racked.h, duration: racked.duration };
      await takePoses(db, store, { attempt_id: id, worker_id: w, pass: 1, ...d, frames: racked.frames });
      await takePoses(db, store, { attempt_id: id, worker_id: w, pass: 2, ...d, frames: racked.frames });
      const [a] = await db.select().from(attempts).where(eq(attempts.id, id));
      expect(a).toMatchObject({ status: 'close_call', call: 'close', lights: null });
      expect(['bench_referee', 'visibility', 'command_times', 'judge_unavailable']).toContain(a.reason);
    });

    it('parseBar refuses a path that is not [t, x, y, score] points', () => {
      expect(parseBar({ attempt_id: 'a', worker_id: 'w', ...dims, path: [[0, 0.5, 0.5]] })).toBeNull();
      expect(parseBar({ attempt_id: 'a', worker_id: 'w', ...dims, path: [[0, 0.5, 0.5, 'x']] })).toBeNull();
      expect(parseBar({ attempt_id: 'a', worker_id: 'w', ...dims, path: [] })).not.toBeNull();
    });
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

  // item 95: a sample's frame is its saved one. The judge still makes the call, but the stored frame (and so
  // the frame route and the marks) is samples.json's, with the server's points there. The good-lift sample's
  // saved 3800 ms is fed points whose own lowest frame is elsewhere, so the judge's pick and the saved frame differ.
  it('a demo sample stores and sends its saved judged frame, and keeps the judge\'s own pick in measures', async () => {
    const good = samples.clips.find(c => c.id === 'good-lift')!;
    const { attempts: [id] } = await seed(db, store, 1);
    await db.update(attempts).set({ isSampleClip: true }).where(eq(attempts.id, id));
    const [{ lifterId }] = await db.select({ lifterId: attempts.lifterId }).from(attempts).where(eq(attempts.id, id));
    await db.insert(events).values({ kind: 'demo_run', attemptId: id, detail: { lifter_id: lifterId, sample: true, lift: 'squat', clip: good.id } });
    await markUploaded(db, store, id, CT);
    const w = await worker('w-sample');
    await claimNext(db, store, w);
    const dims = { w: racked.w, h: racked.h, duration: racked.duration };
    await takePoses(db, store, { attempt_id: id, worker_id: w, pass: 1, ...dims, frames: racked.frames });
    await takePoses(db, store, { attempt_id: id, worker_id: w, pass: 2, ...dims, frames: racked.frames });
    const [a] = await db.select().from(attempts).where(eq(attempts.id, id));
    const own = v0.result!.reps[0].judgedFrameMs;
    expect(own).not.toBe(good.judged_frame_ms);
    expect(a).toMatchObject({ status: 'judged', call: 'white', judgedFrameMs: good.judged_frame_ms });
    expect(a.measures).toMatchObject({ judged_frame_ms: own });
    const f = await judgedFrame(db, store, id, lifterId);
    expect(f.status).toBe(200);
    if (f.status !== 200) return;
    expect(f.frame.ms).toBe(good.judged_frame_ms);
    const near = racked.frames.filter(x => x.p).reduce((b, x) => (Math.abs(x.t - good.judged_frame_ms) < Math.abs(b.t - good.judged_frame_ms) ? x : b));
    expect(f.frame.p).toEqual(near.p);
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
