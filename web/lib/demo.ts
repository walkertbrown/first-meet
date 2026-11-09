// The demo meet (plan 5.36), phase 2's part: a demo lifter, the always-open "Demo meet", their
// first squat attempt (filmed, or a sample lift run through the real server path), and the limits.
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, events, lifters, meets, type Division } from '@/db/schema';
import { keys, type R2 } from '@/lib/r2';
import { logEvent, markUploaded } from '@/lib/queue';
import samples from '../../content/samples/samples.json';

export const DEMO_SLUG = 'demo';
export const DEMO_DEFAULT_NAME = 'Demo lifter';
/** The demo's openers (5.36): Barbell squat 100 lb; Home goblet squat, 10 reps at the 25 lb bell. */
export const DEMO_OPENER = { barbell: { weight: 100, reps: null }, home: { weight: 25, reps: 10 } } as const;

export const demoLimits = (env = process.env) => ({
  perLifter: Number(env.DEMO_RUNS_PER_LIFTER_PER_DAY ?? 30),
  perDay: Number(env.DEMO_RUNS_PER_DAY ?? 300),
});

export async function demoMeet(db: Db) {
  await db.insert(meets).values({ slug: DEMO_SLUG, name: 'Demo meet', kind: 'demo', status: 'open' }).onConflictDoNothing();
  const [m] = await db.select().from(meets).where(eq(meets.slug, DEMO_SLUG));
  return m;
}

export const cleanCardName = (s: unknown) => {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  return t || DEMO_DEFAULT_NAME;
};

/** "Start the demo meet": the demo lifter and their first attempt. */
export async function startDemo(db: Db, input: { cardName?: unknown; division?: unknown }) {
  const division: Division = input.division === 'home' ? 'home' : 'barbell';
  const meet = await demoMeet(db);
  const [lifter] = await db.insert(lifters).values({
    cardName: cleanCardName(input.cardName), division, isDemo: true, meetId: meet.id,
    homeMeetWeights: division === 'home' ? { squat: 25, bench: 15, deadlift: 20 } : null,
  }).returning();
  const attempt = await newFirstAttempt(db, lifter.id, meet.id, division);
  return { lifter, attempt, meet };
}

async function newFirstAttempt(db: Db, lifterId: string, meetId: string, division: Division) {
  const o = DEMO_OPENER[division];
  const [a] = await db.insert(attempts).values({ lifterId, meetId, lift: 'squat', number: 1, weight: o.weight, repsDeclared: o.reps }).returning();
  return a;
}

/**
 * Phase 2 has only the first attempt, so "Lift it again" takes it again: the old one is removed
 * (its events stay, so the day's limits still count it) and a fresh attempt 1 is made.
 */
export async function liftAgain(db: Db, lifterId: string) {
  const [l] = await db.select().from(lifters).where(and(eq(lifters.id, lifterId), eq(lifters.isDemo, true)));
  if (!l || !l.meetId) return null;
  await db.delete(attempts).where(and(eq(attempts.lifterId, lifterId), eq(attempts.meetId, l.meetId)));
  return newFirstAttempt(db, lifterId, l.meetId, l.division);
}

/** Today's demo runs, from midnight Eastern: this lifter's, and everyone's. */
export async function demoRunsToday(db: Db, lifterId: string) {
  const [r] = await db.execute<{ mine: number; all: number }>(sql`
    select count(*) filter (where detail->>'lifter_id' = ${lifterId}) as mine, count(*) as all
    from ${events}
    where kind = 'demo_run' and at >= (date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York')`);
  return { mine: Number(r.mine), all: Number(r.all) };
}

export type LimitHit = 'lifter' | 'everyone';
export async function demoLimitHit(db: Db, lifterId: string, env = process.env): Promise<LimitHit | null> {
  const lim = demoLimits(env);
  const n = await demoRunsToday(db, lifterId);
  if (n.all >= lim.perDay) return 'everyone';
  if (n.mine >= lim.perLifter) return 'lifter';
  return null;
}

/** Counts one demo run (a filmed upload or a sample) toward the limits. */
export const countDemoRun = (db: Db, lifterId: string, attemptId: string, sample: boolean) =>
  logEvent(db, 'demo_run', { lifter_id: lifterId, sample }, attemptId);

type SampleClip = { id: string; kind: 'good' | 'no' | 'close'; file: string; credit: string; meet?: { lift: 'squat'; reps: number; command_times: Record<string, number> } };
/** The squat's sample lifts for the demo, in the order they cycle (5.36). */
export const DEMO_SAMPLES = (samples.clips as SampleClip[]).filter(c => c.meet?.lift === 'squat');

/**
 * "Use a sample lift instead" (5.36): the server copies the stored sample in R2 to the attempt's
 * key, with its stored command_times, then queues it, so R2 → queue → Workflow → lights all run.
 */
export async function sampleLift(db: Db, store: Pick<R2, 'copy' | 'head' | 'putJson' | 'getJson' | 'signedGet'>, lifterId: string, attemptId: string) {
  const [a] = await db.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!a || a.lifterId !== lifterId) return { status: 404 as const, error: 'no such attempt' };
  const [l] = await db.select().from(lifters).where(eq(lifters.id, lifterId));
  if (!l?.isDemo) return { status: 403 as const, error: 'demo lifters only' };
  if (!['declared', 'recording', 'uploading'].includes(a.status)) return { status: 409 as const, error: `attempt is ${a.status}` };
  const hit = await demoLimitHit(db, lifterId);
  if (hit) return { status: 429 as const, error: 'limit', limit: hit };
  if (!DEMO_SAMPLES.length) return { status: 409 as const, error: 'no sample lifts' };
  const [{ n }] = await db.execute<{ n: number }>(sql`select count(*) as n from ${events} where kind = 'demo_run' and detail->>'lifter_id' = ${lifterId} and (detail->>'sample')::boolean`);
  const clip = DEMO_SAMPLES[Number(n) % DEMO_SAMPLES.length];
  const key = keys.meetVideo(a.meetId, a.lifterId, a.id, 'mp4');
  await store.copy(keys.sample(clip.file), key);
  // 5.36: a sample standing in for a Home attempt is judged on the clip's reps ("25 × 1")
  await db.update(attempts).set({ videoKey: key, status: 'uploading', isSampleClip: true, recordedAt: new Date(), repsDeclared: a.repsDeclared ? clip.meet!.reps : null })
    .where(eq(attempts.id, a.id));
  await countDemoRun(db, lifterId, a.id, true);
  const r = await markUploaded(db, store, a.id, clip.meet!.command_times);
  if (r.status !== 200) return r;
  return { status: 200 as const, attempt: { id: a.id, status: r.attempt.status }, sample: { id: clip.id, kind: clip.kind, credit: clip.credit, reps: clip.meet!.reps } };
}

/** Under "SAMPLE LIFT" on a Home attempt (5.36). */
export const sampleRepsLine = (n: number) =>
  n === 1 ? "This sample is one rep, so it's judged as one." : `This sample is ${n} reps, so it's judged as ${n}.`;
