// The judge queue (plan 3.9): an uploaded attempt waits in judge_queue; workers (the
// Workflow's find_poses runs) claim the oldest with FOR UPDATE SKIP LOCKED, post its points
// in two passes, and the web service judges. The lease is the backstop for a worker that
// never posts.
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, events, judgeQueue, judgeWorkers } from '@/db/schema';
import { judgeAttempt, mergePasses, zoomWindows, type Frame, type MeetLift } from '@/lib/judge';
import { keys } from '@/lib/r2';

/** What the queue needs from R2 (web/lib/r2.ts), so the tests can use a stand-in. */
export interface Store {
  head(key: string): Promise<{ bytes: number; type: string | null } | null>;
  putJson(key: string, value: unknown): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
  signedGet(key: string, seconds?: number): Promise<string>;
}

export const LEASE_BASE_S = 120;
export const LIVE_CHANNEL = 'fm_live';

export type LiveEvent =
  | { kind: 'attempt'; attempt_id: string; lifter_id: string; status: string }
  | { kind: 'close_calls'; attempt_id: string }
  /** a corner's cheer for her (5.4) */
  | { kind: 'cheer'; lifter_id: string; attempt_id: string; cheer: string; name: string | null };

export async function publish(db: Db, e: LiveEvent) {
  await db.execute(sql`select pg_notify(${LIVE_CHANNEL}, ${JSON.stringify(e)})`);
}

export async function logEvent(db: Db, kind: string, detail: Record<string, unknown> = {}, attemptId: string | null = null) {
  await db.insert(events).values({ kind, attemptId, detail });
}

/** The longest a recording runs (3.10: a Home attempt is up to 90 s). */
export const MAX_CLIP_MS = 90_000;
/** The most a clip may weigh: 90 s at 2.5 Mbps (The Playner, Nov 8). */
export const MAX_CLIP_BYTES = 28 * 1024 * 1024;

/**
 * A clip's length from its command times: the last command, then 1.5 s more (piece 5).
 * Never past the longest clip, so a lease or a signed link can't run for days.
 */
export const clipSecondsOf = (ct: Record<string, number> | null | undefined) =>
  ct ? Math.min(MAX_CLIP_MS / 1000 + 1.5, Math.max(1, Math.max(0, ...Object.values(ct).filter(Number.isFinite)) / 1000 + 1.5)) : 30;

/** A command time past the longest clip can't be in it: a close call with no judge run. */
const pastLongestClip = (ct: Record<string, number> | null | undefined) =>
  !!ct && typeof ct === 'object' && Object.values(ct).some(v => typeof v === 'number' && v > MAX_CLIP_MS);

/**
 * Step 1: the phone says the upload is done (or the demo copied a sample lift into place).
 * The object must be in R2. Sets `queued` and adds the `poses` row. Doing it twice is harmless.
 */
export async function markUploaded(db: Db, store: Store, attemptId: string, commandTimes: Record<string, number> | null) {
  const [a] = await db.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!a) return { status: 404 as const, error: 'no such attempt' };
  if (['queued', 'judging', 'judged', 'close_call'].includes(a.status)) return { status: 200 as const, attempt: a };
  if (a.status === 'void') return { status: 409 as const, error: 'attempt is void' };
  if (!a.videoKey) return { status: 409 as const, error: 'no upload started' };
  const head = await store.head(a.videoKey);
  if (!head || head.bytes === 0) return { status: 409 as const, error: 'video not in storage' };
  if (head.bytes > MAX_CLIP_BYTES) {
    // 3.11 "Your clip didn't send": nothing judged, and the attempt is hers again
    await db.update(attempts).set({ status: 'declared', videoKey: null, recordedAt: null })
      .where(and(eq(attempts.id, attemptId), sql`${attempts.status} in ('declared','recording','uploading')`));
    await logEvent(db, 'upload_refused', { bytes: head.bytes, why: 'too big' }, attemptId);
    return { status: 413 as const, error: 'clip too big' };
  }
  const ct = commandTimes ?? a.commandTimes;
  const outside = pastLongestClip(ct);
  const status = outside ? 'close_call' : 'queued';
  const updated = await db.transaction(async tx => {
    const [u] = await tx.update(attempts)
      .set(outside
        ? { status, uploadedAt: sql`now()`, commandTimes: ct, call: 'close', reason: 'command_times', lights: null, judgedAt: sql`now()`, measures: { command_times: 'outside_clip' } }
        : { status, uploadedAt: sql`now()`, commandTimes: ct })
      .where(and(eq(attempts.id, attemptId), sql`${attempts.status} in ('declared','recording','uploading')`))
      .returning();
    if (u && !outside) await tx.insert(judgeQueue).values({ attemptId, kind: 'poses', clipSeconds: clipSecondsOf(ct) }).onConflictDoNothing();
    return u;
  });
  if (updated) {
    await logEvent(db, 'uploaded', { bytes: head.bytes, type: head.type }, attemptId);
    if (outside) await logEvent(db, 'close_call', { reason: 'command_times', command_times: 'outside_clip' }, attemptId);
    await publish(db, { kind: 'attempt', attempt_id: attemptId, lifter_id: a.lifterId, status });
  }
  return { status: 200 as const, attempt: updated ?? a };
}

export type Job = { attempt_id: string; video_url: string; command_times: Record<string, number> | null; lift: string; clip_seconds: number };

/** Step 3: the oldest waiting attempt, leased to this worker; null when nothing waits. */
export async function claimNext(db: Db, store: Store, workerId: string): Promise<Job | null> {
  const got = await db.transaction(async tx => {
    const rows = await tx.execute<{ attempt_id: string; clip_seconds: number }>(sql`
      select attempt_id, clip_seconds from judge_queue
      where kind = 'poses' and worker_id is null and next_try_at <= now()
      order by enqueued_at
      limit 1
      for update skip locked`);
    const row = rows[0];
    if (!row) return null;
    await tx.update(judgeQueue).set({
      workerId,
      startedAt: sql`now()`,
      leasedUntil: sql`now() + make_interval(secs => ${LEASE_BASE_S + Number(row.clip_seconds)})`,
    }).where(and(eq(judgeQueue.attemptId, row.attempt_id), eq(judgeQueue.kind, 'poses')));
    const [a] = await tx.update(attempts).set({ status: 'judging' }).where(eq(attempts.id, row.attempt_id)).returning();
    return { row, a };
  });
  await db.update(judgeWorkers)
    .set(got ? { lastSeenAt: sql`now()`, idleAt: null } : { lastSeenAt: sql`now()`, idleAt: sql`now()` })
    .where(eq(judgeWorkers.workerId, workerId));
  if (!got) return null;
  const { row, a } = got;
  await publish(db, { kind: 'attempt', attempt_id: a.id, lifter_id: a.lifterId, status: 'judging' });
  return {
    attempt_id: a.id, video_url: await store.signedGet(a.videoKey!, LEASE_BASE_S + Number(row.clip_seconds)),
    command_times: a.commandTimes, lift: judgedLift(a), clip_seconds: Number(row.clip_seconds),
  };
}

export type PosesPost = {
  attempt_id: string; worker_id: string; pass: 1 | 2;
  w: number; h: number; duration: number; frames: Frame[];
  commit?: string; secs?: number; download_secs?: number;
};

export function parsePoses(body: unknown): PosesPost | null {
  const b = body as PosesPost;
  if (!b || typeof b !== 'object' || typeof b.attempt_id !== 'string' || typeof b.worker_id !== 'string') return null;
  if (b.pass !== 1 && b.pass !== 2) return null;
  if (![b.w, b.h, b.duration].every(n => typeof n === 'number' && n > 0 && Number.isFinite(n))) return null;
  if (!Array.isArray(b.frames) || b.frames.some(f => !f || typeof f.t !== 'number' || (f.p !== null && !Array.isArray(f.p)))) return null;
  return b;
}

const judgeLift = (lift: string): 'squat' | 'deadlift' => (lift === 'deadlift' ? 'deadlift' : 'squat');

/**
 * The lift the judge runs. A sample lift standing in for an attempt is judged as the lift the
 * clip shows (5.36: a lift without its own clips uses the squat's), which its command times name.
 */
export const judgedLift = (a: { lift: string; isSampleClip: boolean; commandTimes: Record<string, number> | null }): string =>
  a.isSampleClip && a.commandTimes && 'squat' in a.commandTimes ? 'squat' : a.lift;

/**
 * Step 5: a worker's points. Pass 1 (5 fps, the whole clip) is kept and answered with where
 * pass 2 looks. Pass 2 is merged with it and judged. Points from a worker that no longer
 * holds the attempt (its lease ran out and it was requeued) are dropped.
 */
export async function takePoses(db: Db, store: Store, p: PosesPost):
  Promise<{ status: 200; windows?: [number, number][]; split_ms?: number | null; call?: string } | { status: 409 | 404; error: string }> {
  const [held] = await db.select({ q: judgeQueue, a: attempts }).from(judgeQueue)
    .innerJoin(attempts, eq(attempts.id, judgeQueue.attemptId))
    .where(and(eq(judgeQueue.attemptId, p.attempt_id), eq(judgeQueue.kind, 'poses')));
  if (!held) return { status: 404, error: 'not in the queue' };
  if (held.q.workerId !== p.worker_id) return { status: 409, error: 'not held by this worker' };
  const a = held.a;
  const dims = { w: p.w, h: p.h, duration: p.duration };
  if (p.pass === 1) {
    await store.putJson(keys.firstPass(a.id), { ...dims, frames: p.frames });
    const zoom = zoomWindows(p.frames, dims, judgeLift(judgedLift(a)), a.commandTimes ?? {});
    return { status: 200, windows: zoom.windows, split_ms: zoom.splitMs };
  }
  const first = await store.getJson<{ frames: Frame[] }>(keys.firstPass(a.id));
  const frames = mergePasses(first?.frames ?? [], p.frames);
  const v = judgeAttempt(frames, dims, judgedLift(a) as MeetLift, a.commandTimes, undefined, a.repsDeclared);
  const posesKey = keys.poses(a.id);
  await store.putJson(posesKey, { ...dims, frames, commit: p.commit ?? null });
  const close = v.call.light === 'close';
  const status = close ? 'close_call' : 'judged';
  const done = await db.transaction(async tx => {
    // the row is still ours: delete it, and only then save the call
    const gone = await tx.delete(judgeQueue)
      .where(and(eq(judgeQueue.attemptId, a.id), eq(judgeQueue.kind, 'poses'), eq(judgeQueue.workerId, p.worker_id)))
      .returning({ startedAt: judgeQueue.startedAt });
    if (!gone.length) return false;
    await tx.update(attempts).set({
      status, posesKey, judgedAt: sql`now()`,
      call: v.call.light, lights: v.lights, repLights: v.repLights, reason: 'reason' in v.call ? v.call.reason : null,
      measures: { ...v.measures, commit: p.commit ?? null }, judgedFrameMs: v.judgedFrameMs,
    }).where(eq(attempts.id, a.id));
    await tx.update(judgeWorkers).set({ attemptsDone: sql`${judgeWorkers.attemptsDone} + 1`, lastSeenAt: sql`now()` })
      .where(eq(judgeWorkers.workerId, p.worker_id));
    return true;
  });
  if (!done) return { status: 409, error: 'not held by this worker' };
  const uploadToLights = a.uploadedAt ? (Date.now() - new Date(a.uploadedAt).getTime()) / 1000 : null;
  await logEvent(db, 'judged', {
    call: v.call.light, reason: 'reason' in v.call ? v.call.reason : null, pose_secs: p.secs ?? null, download_secs: p.download_secs ?? null,
    upload_to_lights_s: uploadToLights !== null ? +uploadToLights.toFixed(2) : null, clip_s: p.duration, commit: p.commit ?? null,
    worker_id: p.worker_id, demo: a.isSampleClip || undefined,
  }, a.id);
  console.log(JSON.stringify({ msg: 'judged', attempt_id: a.id, call: v.call.light, upload_to_lights_s: uploadToLights, pose_secs: p.secs }));
  await publish(db, { kind: 'attempt', attempt_id: a.id, lifter_id: a.lifterId, status });
  return { status: 200, call: v.call.light };
}

/**
 * A worker couldn't judge one attempt (a clip it can't read, a post refused): that attempt
 * alone becomes a close call, `judge_unavailable` (3.11), and the worker goes on. Only the
 * worker holding the attempt can say so.
 */
export async function workerFailed(db: Db, attemptId: string, workerId: string, why: string): Promise<boolean> {
  const a = await db.transaction(async tx => {
    const gone = await tx.delete(judgeQueue)
      .where(and(eq(judgeQueue.attemptId, attemptId), eq(judgeQueue.kind, 'poses'), eq(judgeQueue.workerId, workerId)))
      .returning({ id: judgeQueue.attemptId });
    if (!gone.length) return null;
    const [u] = await tx.update(attempts).set({ status: 'close_call', call: 'close', reason: 'judge_unavailable', lights: null, judgedAt: sql`now()` })
      .where(eq(attempts.id, attemptId)).returning();
    await tx.insert(events).values({ kind: 'close_call', attemptId, detail: { reason: 'judge_unavailable', why: why.slice(0, 300), worker_id: workerId } });
    return u;
  });
  if (!a) return false;
  await publish(db, { kind: 'attempt', attempt_id: a.id, lifter_id: a.lifterId, status: 'close_call' });
  return true;
}

export async function workerDone(db: Db, workerId: string, commit: string | null) {
  await db.update(judgeWorkers).set({ endedAt: sql`now()`, commit, lastSeenAt: sql`now()` })
    .where(and(eq(judgeWorkers.workerId, workerId), sql`${judgeWorkers.endedAt} is null`));
}

/**
 * Step 4: leases that ran out. The first time, the attempt goes back in the queue
 * (`requeued`); the second time it becomes a close call, `judge_unavailable`.
 */
export async function expireLeases(db: Db): Promise<{ requeued: string[]; closeCalls: string[] }> {
  return db.transaction(async tx => {
    const out = await tx.execute<{ attempt_id: string; requeued: boolean; worker_id: string }>(sql`
      select attempt_id, requeued, worker_id from judge_queue
      where kind = 'poses' and leased_until < now()
      for update skip locked`);
    const requeued: string[] = [], closeCalls: string[] = [];
    for (const r of out) {
      if (!r.requeued) {
        await tx.update(judgeQueue).set({ requeued: true, workerId: null, leasedUntil: null, startedAt: null, nextTryAt: sql`now()`, lastError: `lease ran out (${r.worker_id})` })
          .where(and(eq(judgeQueue.attemptId, r.attempt_id), eq(judgeQueue.kind, 'poses')));
        await tx.update(attempts).set({ status: 'queued' }).where(eq(attempts.id, r.attempt_id));
        requeued.push(r.attempt_id);
      } else {
        await tx.delete(judgeQueue).where(and(eq(judgeQueue.attemptId, r.attempt_id), eq(judgeQueue.kind, 'poses')));
        await tx.update(attempts).set({ status: 'close_call', call: 'close', reason: 'judge_unavailable', lights: null, judgedAt: sql`now()` })
          .where(eq(attempts.id, r.attempt_id));
        closeCalls.push(r.attempt_id);
      }
      // the worker that held it no longer counts as alive (3.9 step 4)
      await tx.update(judgeWorkers).set({ endedAt: sql`now()` }).where(and(eq(judgeWorkers.workerId, r.worker_id), sql`${judgeWorkers.endedAt} is null`));
    }
    for (const id of requeued) await tx.insert(events).values({ kind: 'requeued', attemptId: id, detail: {} });
    for (const id of closeCalls) await tx.insert(events).values({ kind: 'close_call', attemptId: id, detail: { reason: 'judge_unavailable', why: 'lease ran out twice' } });
    return { requeued, closeCalls };
  });
}

/**
 * Starts failing for a long time (429s or 5xx): an attempt still waiting 15 minutes after its
 * upload becomes a close call, `judge_unavailable` (3.9 step 4).
 */
export async function giveUpWaiting(db: Db, maxWaitS = 15 * 60): Promise<string[]> {
  const rows = await db.execute<{ attempt_id: string }>(sql`
    delete from judge_queue
    where kind = 'poses' and worker_id is null and enqueued_at < now() - make_interval(secs => ${maxWaitS})
    returning attempt_id`);
  for (const r of rows) {
    await db.update(attempts).set({ status: 'close_call', call: 'close', reason: 'judge_unavailable', lights: null, judgedAt: sql`now()` }).where(eq(attempts.id, r.attempt_id));
    await logEvent(db, 'close_call', { reason: 'judge_unavailable', why: 'waited 15 minutes' }, r.attempt_id);
  }
  return rows.map(r => r.attempt_id);
}
