// The phone's meet video upload (3.10) on Postgres: start, sign parts, resume, finish, queue.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, events, judgeQueue } from '../../web/db/schema';
import { countDemoRun, startDemo } from '../../web/lib/demo';
import { attemptUploaded, partsDone, signParts, startAttemptUpload, uploadFailed } from '../../web/lib/uploads';
import { freshDb, MemStore, URL_ } from './setup';

describe.skipIf(!URL_)('the meet video upload', () => {
  let db: Db, drop: () => Promise<void>;
  const store = new MemStore();
  beforeAll(async () => { ({ db, drop } = await freshDb(4)); });
  afterAll(async () => drop?.());

  const ct = { loaded: 0, squat: 1800, rack: 5200 };

  it('starts at meet/<meet>/<lifter>/<attempt>.<ext>, signs parts, resumes from what R2 has, then queues once', async () => {
    const { lifter, attempt, meet } = await startDemo(db, { division: 'barbell' });
    const s = await startAttemptUpload(db, store, attempt.id, lifter.id, 'video/webm;codecs=vp9');
    if (!('uploadId' in s)) throw new Error(JSON.stringify(s));
    expect(s.key).toBe(`meet/${meet.id}/${lifter.id}/${attempt.id}.webm`);
    const signed = await signParts(db, store, attempt.id, lifter.id, s.uploadId, [1, 2]);
    expect(signed).toMatchObject({ status: 200, urls: { 1: expect.stringContaining('partNumber=1'), 2: expect.any(String) } });
    // part 1 lands, then the phone reloads: it asks what R2 has and sends only part 2
    store.putPart(s.uploadId, 1);
    expect(await partsDone(db, store, attempt.id, lifter.id, s.uploadId)).toMatchObject({ done: false, parts: [{ part: 1 }] });
    store.putPart(s.uploadId, 2);
    const parts = [{ part: 1, etag: '"etag-1"' }, { part: 2, etag: '"etag-2"' }];
    const r = await attemptUploaded(db, store, attempt.id, lifter.id, { upload_id: s.uploadId, parts, command_times: ct });
    expect(r).toMatchObject({ status: 200, attempt: { status: 'queued' } });
    const [a] = await db.select().from(attempts).where(eq(attempts.id, attempt.id));
    expect(a.commandTimes).toEqual(ct);
    expect(store.objects.has(s.key)).toBe(true);
    // the phone didn't hear back and sends it again: still one queue row, one demo run
    expect(await attemptUploaded(db, store, attempt.id, lifter.id, { upload_id: s.uploadId, parts, command_times: ct })).toMatchObject({ status: 200 });
    expect(await db.select().from(judgeQueue).where(eq(judgeQueue.attemptId, attempt.id))).toHaveLength(1);
    const runs = (await db.select().from(events).where(eq(events.kind, 'demo_run'))).filter(e => (e.detail as { lifter_id?: string }).lifter_id === lifter.id);
    expect(runs).toHaveLength(1);
    // after it's queued, the resume check says it's done
    expect(await partsDone(db, store, attempt.id, lifter.id, s.uploadId)).toMatchObject({ done: true });
  });

  it('only the attempt\'s own lifter, webm or mp4 only, and an mp4 key for iPhone', async () => {
    const one = await startDemo(db, {});
    const two = await startDemo(db, {});
    expect((await startAttemptUpload(db, store, one.attempt.id, two.lifter.id, 'video/webm')).status).toBe(403);
    expect((await startAttemptUpload(db, store, one.attempt.id, one.lifter.id, 'image/png')).status).toBe(400);
    const s = await startAttemptUpload(db, store, one.attempt.id, one.lifter.id, 'video/mp4');
    expect('key' in s && s.key.endsWith('.mp4')).toBe(true);
    expect((await signParts(db, store, one.attempt.id, one.lifter.id, 'x', [0])).status).toBe(400);
  });

  it('a clip past the size bound is refused before it is finished, and the attempt goes back to ready', async () => {
    const { lifter, attempt } = await startDemo(db, {});
    const s = await startAttemptUpload(db, store, attempt.id, lifter.id, 'video/webm-x;codecs=vp9');
    if (!('uploadId' in s)) throw new Error(JSON.stringify(s));
    // the content type R2 keeps is ours, never the phone's string
    expect(store.uploads.get(s.uploadId)?.type).toBe('video/webm');
    expect((await signParts(db, store, attempt.id, lifter.id, s.uploadId, [7])).status).toBe(400);
    store.putPart(s.uploadId, 1);
    store.partBytes = 29 * 1024 * 1024;
    try {
      const r = await attemptUploaded(db, store, attempt.id, lifter.id, { upload_id: s.uploadId, parts: [{ part: 1, etag: '"etag-1"' }], command_times: ct });
      expect(r).toMatchObject({ status: 413 });
    } finally { store.partBytes = 5; }
    const [a] = await db.select().from(attempts).where(eq(attempts.id, attempt.id));
    expect(a).toMatchObject({ status: 'declared', videoKey: null });
    expect(store.objects.has(s.key)).toBe(false);
  });

  it('a demo lifter over the day\'s limit is turned away before anything uploads', async () => {
    const { lifter, attempt } = await startDemo(db, {});
    for (let i = 0; i < 30; i++) await countDemoRun(db, lifter.id, attempt.id, false);
    expect(await startAttemptUpload(db, store, attempt.id, lifter.id, 'video/webm')).toMatchObject({ status: 429, limit: 'lifter' });
  });

  it('/ops counts (2.4): each upload started, with its device; a refusal once, whether the server or the phone saw it', async () => {
    const { lifter, attempt } = await startDemo(db, {});
    const kinds = async () => (await db.select().from(events).where(eq(events.attemptId, attempt.id))).map(e => [e.kind, e.detail]);
    const s = await startAttemptUpload(db, store, attempt.id, lifter.id, 'video/webm', 'Chrome 142 · Android 15 Pixel 8');
    if (!('uploadId' in s)) throw new Error(JSON.stringify(s));
    expect(await kinds()).toEqual([['upload_started', { device: 'Chrome 142 · Android 15 Pixel 8' }]]);
    // the server refuses it as too big, then the phone reports the same refusal: counted once
    store.putPart(s.uploadId, 1);
    store.partBytes = 29 * 1024 * 1024;
    try {
      expect(await attemptUploaded(db, store, attempt.id, lifter.id, { upload_id: s.uploadId, parts: [{ part: 1, etag: '"etag-1"' }], command_times: ct })).toMatchObject({ status: 413 });
    } finally { store.partBytes = 5; }
    expect(await uploadFailed(db, attempt.id, lifter.id, { error: 'clip too big' }, 'Chrome 142 · Android 15 Pixel 8')).toEqual({ status: 200, counted: false });
    // she lifts it again; this upload fails on the phone (not one the server saw): counted
    await startAttemptUpload(db, store, attempt.id, lifter.id, 'video/webm', 'Chrome 142 · Android 15 Pixel 8');
    expect(await uploadFailed(db, attempt.id, lifter.id, { error: 'attempt is void' })).toEqual({ status: 200, counted: true });
    const failed = await db.select().from(events).where(and(eq(events.attemptId, attempt.id), eq(events.kind, 'upload_failed')));
    expect(failed.map(e => e.detail)).toEqual([{ device: 'unknown', error: 'attempt is void', before_start: false }]);
    expect((await kinds()).map(k => k[0])).toEqual(['upload_started', 'upload_refused', 'upload_started', 'upload_failed']);
    // only her own attempt
    const other = await startDemo(db, {});
    expect((await uploadFailed(db, attempt.id, other.lifter.id, { error: 'x' })).status).toBe(403);
  });

  it('a clip the phone turned down before any upload began counts as tried and failed', async () => {
    const { lifter, attempt } = await startDemo(db, {});
    expect(await uploadFailed(db, attempt.id, lifter.id, { error: 'clip too big', before_start: true }, 'Safari 18 · iPhone')).toEqual({ status: 200, counted: true });
    const [e] = await db.select().from(events).where(and(eq(events.attemptId, attempt.id), eq(events.kind, 'upload_failed')));
    expect(e.detail).toEqual({ device: 'Safari 18 · iPhone', error: 'clip too big', before_start: true });
  });
});
