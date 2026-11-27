// Her lift clip (plan 3.9 step 6, piece 7, look 9 "Lift clip"): render_clip's job, made here so the
// worker only draws. Queued once when her total (or Home score, or her bomb-out) lands, for her best lift,
// and again only if a referee changes which lift that is. Claimed only while no `poses` row waits.
// A bomb-out's clip (item 101) ends on her best lift's end frame in place of the story card.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, judgeQueue, judgeWorkers, lifters } from '@/db/schema';
import { asMeetAttempt, meetAttempts, totalFor, type LifterRow } from '@/lib/meet-flow';
import { bestLiftOf, type MeetAttempt } from '@/lib/meet';
import { endFramePath } from '@/lib/card/best-lift';
import { ensureCardToken } from '@/lib/card/card-data';
import { judgedLift, logEvent } from '@/lib/queue';
import { keys } from '@/lib/r2';
import { liftName, weightText } from '@/lib/referee-view';
import { nearSide, poseAt, type Frame, type Side } from '@/lib/judge/pose';
import { timesOnly } from '@/lib/judge/bar-measure';
import { liftMarks } from '@/lib/stage/snap';
import { heldFrameMs } from '@/lib/stage/held-frame';
import type { RepLight } from '@/db/schema';

/** The clip is 15 s or less: her attempt, the lamps (1.41 s), a 2 s hold, the card (0.4 s + 3 s). */
export const CLIP_TIMES = { lampsMs: 330 * 3 + 420, lampGapMs: 330, holdMs: 2000, fadeMs: 400, cardMs: 3000 } as const;
export const CLIP_MAX_MS = 15_000;
/** So the whole clip fits in 15 s. */
export const FOOTAGE_MAX_MS = CLIP_MAX_MS - CLIP_TIMES.lampsMs - CLIP_TIMES.holdMs - CLIP_TIMES.fadeMs - CLIP_TIMES.cardMs - 190;
/** A clip run's lease: download, draw ~450 frames, encode, upload. */
export const CLIP_LEASE_S = 300;
/** Clip runs' worker ids start with this, so the pose counts leave them out. */
export const CLIP_WORKER = 'c-';

export const clipLength = (footageMs: number) =>
  footageMs + CLIP_TIMES.lampsMs + CLIP_TIMES.holdMs + CLIP_TIMES.fadeMs + CLIP_TIMES.cardMs;

/**
 * The part of her attempt the clip shows (piece 7). Barbell: the lift, from just before the soft
 * command to a second after her last command. Home, on a white: the last 3 reps; on a red: the missed
 * rep and the 2 before it. Never longer than FOOTAGE_MAX_MS: the end (the rep the lights are for) stays.
 */
export function clipWindow(a: { call: string | null; repLights: RepLight[] | null; commandTimes: Record<string, unknown> | null }): { startMs: number; endMs: number } {
  const t = a.commandTimes ? Object.values(timesOnly(a.commandTimes as never)).filter(Number.isFinite) : [];
  const first = t.length ? Math.min(...t) : 0;
  const last = t.length ? Math.max(...t) : FOOTAGE_MAX_MS;
  let start = Math.max(0, first - 500);
  let end = last + 1000;
  const bottoms = (a.repLights ?? []).map(r => r.frame_ms).filter((v): v is number => typeof v === 'number');
  if (bottoms.length === (a.repLights ?? []).length && bottoms.length > 1) {
    // a rep runs from halfway after the bottom before it; its own bottom is at `bottoms[k]`
    const repStart = (k: number) => (k <= 0 ? start : (bottoms[k - 1] + bottoms[k]) / 2);
    const red = a.repLights!.findIndex(r => r.call === 'red');
    if (a.call === 'red' && red >= 0) {
      start = repStart(red - 2);
      end = Math.min(end, red + 1 < bottoms.length ? (bottoms[red] + bottoms[red + 1]) / 2 : end);
    } else {
      start = repStart(bottoms.length - 3);
    }
  }
  start = Math.max(start, end - FOOTAGE_MAX_MS, 0);
  return { startMs: Math.round(start), endMs: Math.round(end) };
}

/** The lamps' colours and the marks' (look 9 step 10): lamp white, lamp red, or stage-ink-2. */
export const CLIP_COLOURS = { white: '#FFF4D8', red: '#F0302A', close: '#A6A9B3' } as const;

export type ClipJob = {
  attempt_id: string; worker_id: string; video_url: string;
  start_ms: number; end_ms: number; judged_ms: number;
  lamps: ('white' | 'red')[];
  /** the judge's marks on the judged frame, as fractions of the frame; null with no pose there */
  marks: { pts: [number, number][]; colour: string } | null;
  /** her stage shows her front camera mirrored, so the clip does too; a sample lift isn't */
  mirror: boolean;
  /** her story card, on this site: the worker puts its APP_URL in front. A bomb-out: her best lift's end frame, signed */
  card_path: string;
  /** landscape footage (the presses): "BENCH · 2 OF 3" and "85 lb" under it (look 9) */
  lift_line: string; weight: string;
  upload_url: string;
  /** the poster beside the clip (look 9): the first frame of the 2 s hold, a 432 × 768 JPEG */
  poster_url: string;
  /** FAULT=clip (staging only, as /healthz's): the run fails this clip on purpose, through the real failure path (item 102) */
  fault?: true;
  times: typeof CLIP_TIMES;
};

/** What clip jobs need from R2. */
export interface ClipStore {
  signedGet(key: string, seconds?: number): Promise<string>;
  signedPut(key: string, seconds?: number): Promise<string>;
  getJson<T>(key: string): Promise<T | null>;
  head(key: string): Promise<{ bytes: number; type: string | null } | null>;
}

/**
 * The lift her clip is of (3.9 step 6, item 101): with a total, the lift on her card; a bomb-out, her best good
 * attempt by the same rule (the heaviest, the later in meet order on a tie; Home, the best score). No good
 * attempt, or no total and no bomb-out yet: null.
 */
export async function clipLiftOf(db: Db, l: LifterRow, now = new Date()): Promise<{ top: MeetAttempt; bombed: boolean } | null> {
  if (!l.meetId) return null;
  const rows = await meetAttempts(db, l);
  const t = await totalFor(db, l, rows, now);
  if (t.kind === 'total') return t.top.id ? { top: t.top, bombed: false } : null;
  if (t.kind !== 'bombed') return null;
  const top = bestLiftOf(rows.map(a => asMeetAttempt(a, l)), l.division);
  return top?.id ? { top, bombed: true } : null;
}

/**
 * Queues her clip when she has a total or bombs out, for her best lift. Does nothing when that attempt's clip is
 * already queued, being made or made; a referee who changes her best lift moves it to the new one.
 * Returns the attempt queued, or null.
 */
export async function queueCardClip(db: Db, lifterId: string, now = new Date()): Promise<string | null> {
  const [l] = await db.select().from(lifters).where(eq(lifters.id, lifterId));
  if (!l || l.deletedAt || !l.meetId) return null;
  const it = await clipLiftOf(db, l, now);
  if (!it) return null;
  const top = it.top;
  const queued = await db.transaction(async tx => {
    const [a] = await tx.update(attempts).set({ clipStatus: 'queued' })
      .where(and(eq(attempts.id, top.id!), isNull(attempts.clipStatus))).returning({ id: attempts.id, ct: attempts.commandTimes, call: attempts.call, rl: attempts.repLights });
    if (!a) return null;
    const w = clipWindow({ call: a.call, repLights: a.rl, commandTimes: a.ct });
    await tx.insert(judgeQueue).values({ attemptId: a.id, kind: 'clip', clipSeconds: clipLength(w.endMs - w.startMs) / 1000 }).onConflictDoNothing();
    // her best lift moved (a referee's decision): the old lift's waiting clip isn't needed
    await tx.delete(judgeQueue).where(and(eq(judgeQueue.kind, 'clip'), isNull(judgeQueue.workerId), sql`${judgeQueue.attemptId} <> ${a.id}`,
      inArray(judgeQueue.attemptId, tx.select({ id: attempts.id }).from(attempts).where(eq(attempts.lifterId, l.id)))));
    return a.id;
  });
  if (queued) await logEvent(db, 'clip_queued', { lifter_id: l.id, bombed: it.bombed || undefined }, queued);
  return queued;
}

/** A clip run asks for its next clip. Only while no `poses` row waits (3.9 step 6). */
export async function claimClip(db: Db, store: ClipStore, workerId: string): Promise<ClipJob | null> {
  const id = await db.transaction(async tx => {
    const rows = await tx.execute<{ attempt_id: string }>(sql`
      select attempt_id from judge_queue
      where kind = 'clip' and worker_id is null and next_try_at <= now()
        and not exists (select 1 from judge_queue p where p.kind = 'poses' and p.worker_id is null)
      order by enqueued_at limit 1 for update skip locked`);
    const r = rows[0];
    if (!r) return null;
    await tx.update(judgeQueue).set({ workerId, startedAt: sql`now()`, leasedUntil: sql`now() + make_interval(secs => ${CLIP_LEASE_S})` })
      .where(and(eq(judgeQueue.attemptId, r.attempt_id), eq(judgeQueue.kind, 'clip')));
    await tx.update(attempts).set({ clipStatus: 'rendering' }).where(eq(attempts.id, r.attempt_id));
    return r.attempt_id;
  });
  await db.update(judgeWorkers).set({ lastSeenAt: sql`now()` }).where(eq(judgeWorkers.workerId, workerId));
  if (!id) return null;
  return clipJob(db, store, id, workerId);
}

export async function clipJob(db: Db, store: ClipStore, attemptId: string, workerId: string): Promise<ClipJob> {
  const [row] = await db.select({ a: attempts, l: lifters }).from(attempts).innerJoin(lifters, eq(lifters.id, attempts.lifterId)).where(eq(attempts.id, attemptId));
  const { a, l } = row!;
  const w = clipWindow({ call: a.call, repLights: a.repLights, commandTimes: a.commandTimes });
  const judgedMs = a.judgedFrameMs ?? heldFrameMs(a.commandTimes, null) ?? w.endMs - 1000;
  const colour = a.call === 'white' ? CLIP_COLOURS.white : a.call === 'red' ? CLIP_COLOURS.red : CLIP_COLOURS.close;
  let marks: ClipJob['marks'] = null;
  if (a.posesKey) {
    const poses = await store.getJson<{ frames: Frame[] }>(a.posesKey);
    const f = poseAt(poses?.frames ?? [], judgedMs);
    if (f) {
      const side = ((a.measures ?? {}) as { side?: Side }).side ?? nearSide(f);
      marks = { pts: liftMarks(judgedLift(a), f.p, { w: 1, h: 1 }, side).pts.map(p => [p.x, p.y] as [number, number]), colour };
    }
  }
  const lights = (a.lights ?? (a.call === 'white' ? ['white', 'white', 'white'] : ['red', 'red', 'red'])) as ('white' | 'red')[];
  // a bomb-out has no card (5.28): the clip ends on her best lift's end frame, which only the run can fetch
  const it = await clipLiftOf(db, l);
  const cardPath = it?.bombed && it.top.id === a.id
    ? endFramePath(a.id, process.env.JUDGE_CALLBACK_SECRET ?? '')
    : `/api/card/${await ensureCardToken(db, l)}.png?f=story`;
  return {
    attempt_id: a.id, worker_id: workerId, video_url: await store.signedGet(a.videoKey!, CLIP_LEASE_S),
    start_ms: w.startMs, end_ms: w.endMs, judged_ms: judgedMs, lamps: lights, marks, mirror: !a.isSampleClip,
    card_path: cardPath,
    lift_line: `${liftName(a.lift, l.division).toUpperCase()} · ${a.number} OF 3`,
    weight: weightText(a.weight, l.units, a.repsDeclared),
    upload_url: await store.signedPut(keys.clip(a.id), CLIP_LEASE_S),
    poster_url: await store.signedPut(keys.clipPoster(a.id), CLIP_LEASE_S),
    times: CLIP_TIMES,
    ...(process.env.FAULT === 'clip' ? { fault: true as const } : {}),
  };
}

export type ClipPost = { attempt_id: string; worker_id: string; ok: boolean; error?: string; secs?: number; bytes?: number; commit?: string };

export function parseClipPost(b: unknown): ClipPost | null {
  const p = b as ClipPost;
  if (!p || typeof p !== 'object' || typeof p.attempt_id !== 'string' || typeof p.worker_id !== 'string' || typeof p.ok !== 'boolean') return null;
  return p;
}

/**
 * The run says how it went. Made: the MP4 must be in R2, then the clip is `ready`. Not made: it's tried once
 * more at once; a second failure leaves it `failed`, and her Clip segment offers "Try again" (item 102).
 */
export async function takeClip(db: Db, store: ClipStore, p: ClipPost): Promise<{ status: 200 | 404 | 409; error?: string }> {
  const [q] = await db.select().from(judgeQueue).where(and(eq(judgeQueue.attemptId, p.attempt_id), eq(judgeQueue.kind, 'clip')));
  if (!q) return { status: 404, error: 'not in the queue' };
  if (q.workerId !== p.worker_id) return { status: 409, error: 'not held by this worker' };
  const head = p.ok ? await store.head(keys.clip(p.attempt_id)) : null;
  if (p.ok && head && head.bytes > 0) {
    await db.transaction(async tx => {
      await tx.delete(judgeQueue).where(and(eq(judgeQueue.attemptId, p.attempt_id), eq(judgeQueue.kind, 'clip')));
      await tx.update(attempts).set({ clipStatus: 'ready', clipKey: keys.clip(p.attempt_id) }).where(eq(attempts.id, p.attempt_id));
      await tx.update(judgeWorkers).set({ attemptsDone: sql`${judgeWorkers.attemptsDone} + 1`, lastSeenAt: sql`now()` }).where(eq(judgeWorkers.workerId, p.worker_id));
    });
    await logEvent(db, 'clip_rendered', { secs: p.secs ?? null, bytes: head.bytes, commit: p.commit ?? null, worker_id: p.worker_id }, p.attempt_id);
    return { status: 200 };
  }
  await clipFailed(db, p.attempt_id, q.requeued, p.error ?? (p.ok ? 'clip not in storage' : 'failed'));
  return { status: 200 };
}

async function clipFailed(db: Db, attemptId: string, requeued: boolean, why: string) {
  if (!requeued) {
    await db.update(judgeQueue).set({ requeued: true, workerId: null, leasedUntil: null, startedAt: null, nextTryAt: sql`now()`, lastError: why.slice(0, 300) })
      .where(and(eq(judgeQueue.attemptId, attemptId), eq(judgeQueue.kind, 'clip')));
    await db.update(attempts).set({ clipStatus: 'queued' }).where(eq(attempts.id, attemptId));
  } else {
    await db.delete(judgeQueue).where(and(eq(judgeQueue.attemptId, attemptId), eq(judgeQueue.kind, 'clip')));
    await db.update(attempts).set({ clipStatus: 'failed' }).where(eq(attempts.id, attemptId));
  }
  await logEvent(db, requeued ? 'clip_failed' : 'clip_requeued', { why: why.slice(0, 300) }, attemptId);
}

/**
 * "Try again" (item 102): a clip that couldn't be made is queued once more, for her own card's attempt, once.
 * That run gets one try: if it fails too, the clip is `failed` for good ("We've told the team.").
 */
export async function retryClip(db: Db, lifterId: string, attemptId: string): Promise<boolean> {
  const queued = await db.transaction(async tx => {
    const [a] = await tx.update(attempts).set({ clipStatus: 'queued', clipRetried: true })
      .where(and(eq(attempts.id, attemptId), eq(attempts.lifterId, lifterId), eq(attempts.clipStatus, 'failed'), eq(attempts.clipRetried, false)))
      .returning({ id: attempts.id, ct: attempts.commandTimes, call: attempts.call, rl: attempts.repLights });
    if (!a) return false;
    const w = clipWindow({ call: a.call, repLights: a.rl, commandTimes: a.ct });
    await tx.insert(judgeQueue).values({ attemptId: a.id, kind: 'clip', requeued: true, clipSeconds: clipLength(w.endMs - w.startMs) / 1000 }).onConflictDoNothing();
    return true;
  });
  if (queued) await logEvent(db, 'clip_retried', { lifter_id: lifterId }, attemptId);
  return queued;
}

/** Clip leases that ran out (the dispatcher's tick): tried once more, then `failed`. */
export async function expireClipLeases(db: Db): Promise<string[]> {
  const rows = await db.execute<{ attempt_id: string; requeued: boolean; worker_id: string }>(sql`
    select attempt_id, requeued, worker_id from judge_queue where kind = 'clip' and leased_until < now()`);
  for (const r of rows) {
    await clipFailed(db, r.attempt_id, r.requeued, `lease ran out (${r.worker_id})`);
    await db.update(judgeWorkers).set({ endedAt: sql`now()` }).where(and(eq(judgeWorkers.workerId, r.worker_id), sql`${judgeWorkers.endedAt} is null`));
  }
  return rows.map(r => r.attempt_id);
}

/** For the dispatcher: clips waiting, and whether a clip run is alive or starting. */
export async function clipCounts(db: Db): Promise<{ waiting: number; running: number }> {
  const [c] = await db.execute<{ waiting: number; running: number }>(sql`
    select
      (select count(*) from judge_queue where kind = 'clip' and worker_id is null and next_try_at <= now()) as waiting,
      (select count(*) from judge_workers where ended_at is null and worker_id like ${CLIP_WORKER + '%'}) as running`);
  return { waiting: Number(c.waiting), running: Number(c.running) };
}

/**
 * After an attempt gets its lights (the judge, the bar tracker or a referee): queue her clip if that
 * gave her a total. Never fails the caller: a clip that couldn't be queued is logged and tried at her next lights.
 */
export async function clipAfterLights(db: Db, attemptId: string): Promise<void> {
  try {
    const [a] = await db.select({ lifterId: attempts.lifterId, status: attempts.status }).from(attempts).where(eq(attempts.id, attemptId));
    if (a?.status === 'judged') await queueCardClip(db, a.lifterId);
  } catch (e) {
    console.log(JSON.stringify({ msg: 'clip not queued', attempt_id: attemptId, error: (e as Error).message }));
  }
}
