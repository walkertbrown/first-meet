// The phone's meet video upload (plan 3.10): the server starts an R2 multipart upload at
// meet/<meet>/<lifter>/<attempt>.<ext>, signs 5 MB part PUTs, lists the parts R2 already has
// (so a reloaded phone resumes), and finishes it. Only the attempt's own lifter can.
import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, lifters } from '@/db/schema';
import { countDemoRun, demoLimitHit, type LimitHit } from '@/lib/demo';
import { extOf, keys, type R2 } from '@/lib/r2';
import { markUploaded } from '@/lib/queue';

export type UploadStore = Pick<R2, 'startUpload' | 'signPart' | 'listParts' | 'finishUpload' | 'head' | 'putJson' | 'getJson' | 'signedGet'>;
type Fail = { status: 400 | 403 | 404 | 409 | 429; error: string; limit?: LimitHit };

const isDemoLifter = async (db: Db, id: string) =>
  !!(await db.select({ d: lifters.isDemo }).from(lifters).where(eq(lifters.id, id)))[0]?.d;
const MAX_PARTS = 40; // 200 MB: a 90 s Home attempt at 1.5 Mbps is about 17 MB

async function own(db: Db, attemptId: string, lifterId: string) {
  const [a] = await db.select().from(attempts).where(and(eq(attempts.id, attemptId)));
  if (!a) return { status: 404, error: 'no such attempt' } as Fail;
  if (a.lifterId !== lifterId) return { status: 403, error: 'not your attempt' } as Fail;
  return a;
}

const isFail = (x: unknown): x is Fail => !!x && typeof x === 'object' && 'error' in x;

/** Starts (or, for the same attempt, starts again) the upload. */
export async function startAttemptUpload(db: Db, store: UploadStore, attemptId: string, lifterId: string, type: string) {
  const a = await own(db, attemptId, lifterId);
  if (isFail(a)) return a;
  if (!['declared', 'recording', 'uploading'].includes(a.status)) return { status: 409, error: `attempt is ${a.status}` } as Fail;
  const ext = extOf(type);
  if (!ext) return { status: 400, error: 'video/webm or video/mp4 only' } as Fail;
  // every demo attempt is a paid Workflow run (5.36): refused before anything is uploaded
  if (await isDemoLifter(db, lifterId)) {
    const hit = await demoLimitHit(db, lifterId);
    if (hit) return { status: 429, error: 'limit', limit: hit } as Fail;
  }
  const key = keys.meetVideo(a.meetId, a.lifterId, a.id, ext);
  const uploadId = await store.startUpload(key, type.split(';')[0]);
  await db.update(attempts).set({ videoKey: key, status: 'uploading', recordedAt: a.recordedAt ?? new Date() }).where(eq(attempts.id, a.id));
  return { status: 200 as const, key, uploadId };
}

export async function signParts(db: Db, store: UploadStore, attemptId: string, lifterId: string, uploadId: string, parts: number[]) {
  const a = await own(db, attemptId, lifterId);
  if (isFail(a)) return a;
  if (!a.videoKey || a.status !== 'uploading') return { status: 409, error: 'no upload started' } as Fail;
  if (!uploadId || !parts.length || parts.some(p => !Number.isInteger(p) || p < 1 || p > MAX_PARTS)) return { status: 400, error: 'bad parts' } as Fail;
  const urls: Record<number, string> = {};
  for (const p of parts.slice(0, MAX_PARTS)) urls[p] = await store.signPart(a.videoKey, uploadId, p);
  return { status: 200 as const, urls };
}

export async function partsDone(db: Db, store: UploadStore, attemptId: string, lifterId: string, uploadId: string) {
  const a = await own(db, attemptId, lifterId);
  if (isFail(a)) return a;
  if (!a.videoKey) return { status: 409, error: 'no upload started' } as Fail;
  if (a.status !== 'uploading') return { status: 200 as const, done: true, parts: [] };
  const parts = await store.listParts(a.videoKey, uploadId);
  if (parts === null) return { status: 404, error: 'upload not found' } as Fail;
  return { status: 200 as const, done: false, parts };
}

/**
 * POST /api/attempts/:id/uploaded (3.9 step 1): finishes the multipart upload if it isn't yet,
 * saves command_times, and queues the attempt. Safe to call again.
 */
export async function attemptUploaded(db: Db, store: UploadStore, attemptId: string, lifterId: string,
  body: { upload_id?: string; parts?: { part: number; etag: string }[]; command_times?: Record<string, number> }) {
  const a = await own(db, attemptId, lifterId);
  if (isFail(a)) return a;
  if (a.status === 'uploading' && a.videoKey && !(await store.head(a.videoKey))) {
    if (!body.upload_id || !body.parts?.length) return { status: 400, error: 'upload_id and parts are needed' } as Fail;
    await store.finishUpload(a.videoKey, body.upload_id, body.parts);
  }
  const ct = body.command_times && typeof body.command_times === 'object' ? body.command_times : null;
  const r = await markUploaded(db, store, attemptId, ct);
  if (r.status !== 200) return r as Fail;
  if (['declared', 'recording', 'uploading'].includes(a.status) && await isDemoLifter(db, lifterId)) await countDemoRun(db, lifterId, a.id, false);
  return { status: 200 as const, attempt: { id: r.attempt.id, status: r.attempt.status } };
}
