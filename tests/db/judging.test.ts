// The judges' wait and paused judging (3.9 steps 8 and 9, item 87): the rate over busy minutes
// only, its stand-ins, and `judgingState()`'s two pause rules.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, events, judgeQueue, judgeWorkers } from '../../web/db/schema';
import { resetBackoff, tick, type Runner } from '../../web/lib/dispatcher';
import { markUploaded } from '../../web/lib/queue';
import { estimateMinutes, judgingState, waitMinutes } from '../../web/lib/attempt-state';
import { freshDb, MemStore, seed, URL_ } from './setup';

class FailingRunner implements Runner {
  async start() { return { ok: false as const, status: 429, error: 'Too Many Requests' }; }
  async status() { return 'running'; }
}

const CT = { loaded: 0, squat: 2000, rack: 6000 };
const BIG = { runStartsPerMin: 100, cpuPerMin: 200, workersMax: 100 };
const ago = (min: number) => new Date(Date.now() - min * 60_000);

describe.skipIf(!URL_)('the judges\' wait and paused judging', () => {
  let db: Db, drop: () => Promise<void>;
  const store = new MemStore();
  beforeAll(async () => ({ db, drop } = await freshDb(4)));
  afterAll(async () => drop?.());
  beforeEach(async () => {
    resetBackoff();
    await db.delete(judgeQueue); await db.delete(judgeWorkers); await db.delete(events); await db.delete(attempts);
  });
  /** n attempts queued now, the first enqueued earliest, each 30 s of clip. */
  const queue = async (n: number, minutesAgo = 0) => {
    const { attempts: ids } = await seed(db, store, n);
    for (const [i, id] of ids.entries()) {
      await markUploaded(db, store, id, CT);
      await db.execute(sql`update judge_queue set enqueued_at = ${new Date(Date.now() - minutesAgo * 60_000 - (n - i) * 1000).toISOString()}::timestamptz, clip_seconds = 30 where attempt_id = ${id}`);
    }
    await db.delete(events);
    return ids;
  };
  /** History: a burst uploaded `from` minutes ago, with one judged a minute (120 s of clip, 40 s pose) until `to`. */
  const history = async (from: number, to: number) => {
    const { attempts: [id] } = await seed(db, store, 1);
    await db.insert(events).values({ kind: 'uploaded', attemptId: id, at: ago(from), detail: {} });
    for (let m = from - 1; m >= to; m--) await db.insert(events).values({ kind: 'judged', attemptId: id, at: ago(m), detail: { clip_s: 120, pose_secs: 40 } });
  };

  it('nothing ahead, nothing finished, no pose times: 1 minute, normal', async () => {
    const [id] = await queue(1);
    expect(await waitMinutes(db, id)).toBe(1);
    expect(await judgingState(db, id)).toEqual({ state: 'normal', minutes: 1 });
  });

  it('no busy minute in 24 hours: a minute of clip takes a minute', async () => {
    const ids = await queue(5);
    // 4 × 30 s ahead ÷ 60 + 30 s: 2.5 → 3
    expect(await waitMinutes(db, ids[4])).toBe(estimateMinutes(120, 0, null, 0));
    expect(await waitMinutes(db, ids[4])).toBe(3);
    expect((await judgingState(db, ids[4])).state).toBe('busy');
  });

  it('attempts ahead after 6 quiet minutes: the rate of the busy minutes before them, not ÷ 0', async () => {
    const ids = await queue(7);
    await history(12, 7);
    // 6 × 30 s ahead at 120 s a minute + a 40 s median: 1.5 + 0.67 → 3 (the ÷ 60 stand-in would say 4)
    expect(await waitMinutes(db, ids[6])).toBe(3);
  });

  it('after 20 quiet minutes, the last 5 busy minutes still give the rate', async () => {
    const ids = await queue(7);
    await history(30, 20);
    expect(await waitMinutes(db, ids[6])).toBe(3);
  });

  it('paused: nothing judged for 3 minutes while one has waited longer; the next judged ends it', async () => {
    const [id] = await queue(1, 4);
    expect(await judgingState(db, id)).toEqual({ state: 'paused', minutes: null });
    await db.insert(events).values({ kind: 'judged', attemptId: id, detail: { clip_s: 30, pose_secs: 40 } });
    expect((await judgingState(db, id)).state).not.toBe('paused');
  });

  it('not paused while the wait is under 3 minutes, or with nothing waiting', async () => {
    const [id] = await queue(1, 2);
    expect((await judgingState(db, id)).state).not.toBe('paused');
    await db.delete(judgeQueue);
    await db.insert(events).values({ kind: 'run_start_failed', detail: { status: 429 } });
    expect((await judgingState(db)).state).not.toBe('paused');
  });

  it('paused: starting workers is failing (Render answers 429, the back-off runs) while one waits', async () => {
    const [id] = await queue(1);
    expect((await judgingState(db, id)).state).toBe('normal');
    const t = await tick(db, new FailingRunner(), BIG);
    expect(t.failed).toBe(1);
    expect(await judgingState(db, id)).toEqual({ state: 'paused', minutes: null });
    // a start that works, then a judged attempt: it ends
    await db.insert(events).values({ kind: 'run_start', detail: {} });
    await db.insert(events).values({ kind: 'judged', attemptId: id, detail: { clip_s: 30 } });
    expect((await judgingState(db, id)).state).not.toBe('paused');
  });
});
