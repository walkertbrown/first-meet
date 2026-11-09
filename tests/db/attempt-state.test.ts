// What the phone reads while it waits for lights (5.25 steps 8–9) and the 90 s estimate (3.9 step 8).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, events } from '../../web/db/schema';
import { startDemo } from '../../web/lib/demo';
import { attemptState } from '../../web/lib/attempt-state';
import { attemptUploaded, startAttemptUpload } from '../../web/lib/uploads';
import { freshDb, MemStore, URL_ } from './setup';

describe.skipIf(!URL_)('an attempt\'s state on the phone', () => {
  let db: Db, drop: () => Promise<void>;
  const store = new MemStore();
  beforeAll(async () => { ({ db, drop } = await freshDb(4)); });
  afterAll(async () => drop?.());

  async function queued() {
    const d = await startDemo(db, { division: 'barbell' });
    const s = await startAttemptUpload(db, store, d.attempt.id, d.lifter.id, 'video/webm');
    if (!('uploadId' in s)) throw new Error(JSON.stringify(s));
    store.putPart(s.uploadId, 1);
    await attemptUploaded(db, store, d.attempt.id, d.lifter.id, { upload_id: s.uploadId, parts: [{ part: 1, etag: '"etag-1"' }], command_times: { loaded: 0, squat: 1800, rack: 5200 } });
    return d;
  }

  it('only her own attempt; 404 for none', async () => {
    const one = await startDemo(db, {});
    const two = await startDemo(db, {});
    expect(await attemptState(db, one.attempt.id, two.lifter.id)).toMatchObject({ status: 403 });
    expect(await attemptState(db, '00000000-0000-0000-0000-000000000000', one.lifter.id)).toMatchObject({ status: 404 });
    expect(await attemptState(db, 'nope', one.lifter.id)).toMatchObject({ status: 404 });
    expect(await attemptState(db, one.attempt.id, one.lifter.id)).toMatchObject({ status: 200, attempt: { status: 'declared', call: null, wait_minutes: null } });
  });

  it('queued: a whole-minute estimate when asked; judged: the call, lights and red rep', async () => {
    const first = await queued();
    const second = await queued();
    await db.insert(events).values({ kind: 'judged', detail: { clip_s: 60, pose_secs: 40 } });
    const r = await attemptState(db, second.attempt.id, second.lifter.id, true);
    if (r.status !== 200) throw new Error(r.error);
    expect(r.attempt.status).toBe('queued');
    expect(Number.isInteger(r.attempt.wait_minutes)).toBe(true);
    expect(r.attempt.wait_minutes).toBeGreaterThanOrEqual(1);
    await db.update(attempts).set({ status: 'judged', call: 'red', reason: 'depth', lights: ['red', 'red', 'red'], measures: { red_rep: 2 } }).where(eq(attempts.id, first.attempt.id));
    expect(await attemptState(db, first.attempt.id, first.lifter.id, true)).toMatchObject({
      status: 200, attempt: { status: 'judged', call: 'red', reason: 'depth', lights: ['red', 'red', 'red'], red_rep: 2, wait_minutes: null },
    });
  });
});
