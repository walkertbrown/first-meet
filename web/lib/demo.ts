// The demo meet (plan 5.36): a demo lifter with a made-up training history (its caps and openers),
// the always-open "Demo meet", the squat opener, sample lifts through the real server path, and the
// limits. The nine attempts after the opener are declared through web/lib/meet-flow.ts.
import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, events, lifters, meets, type Division, type HomeWeight, type Lift } from '@/db/schema';
import { barbellOpener, homeOpener, type Units } from '@/lib/meet';
import { keys, type R2 } from '@/lib/r2';
import { logEvent, markUploaded } from '@/lib/queue';
import { capSentence } from '@/lib/stage/meet-words';
import samples from '../../content/samples/samples.json';

export const DEMO_SLUG = 'demo';
export const DEMO_DEFAULT_NAME = 'Demo lifter';
/**
 * The demo's made-up history (5.36): Barbell caps of squat 115, bench 75 and deadlift 135 lb; Home,
 * 12 reps at the 25 lb bell (goblet squat), the pair of 15s (overhead press) and the pair of 20s
 * (deadlift). The openers come from them by the real rules (3.8, 3.8a): 100, 65, 120; 10 reps.
 */
export const DEMO_CAPS = {
  barbell: { squat: 115, bench: 75, deadlift: 135 } as Record<Lift, number>,
  home: { reps: 12, weights: { squat: 25, bench: 15, deadlift: 20 } as Record<Lift, number> },
} as const;
/** The weights the demo's Home lifter owns. */
export const DEMO_HOME_WEIGHTS: HomeWeight[] = [{ weight: 25, kind: 'bell' }, { weight: 15, kind: 'pair' }, { weight: 20, kind: 'pair' }];

/** A demo lifter's opener for a lift: the weight, and the reps on Home. */
export function demoOpener(division: Division, lift: Lift, units: Units = 'lb') {
  if (division === 'home') return { weight: DEMO_CAPS.home.weights[lift], reps: homeOpener(DEMO_CAPS.home.reps) };
  return { weight: barbellOpener(DEMO_CAPS.barbell[lift], lift, units), reps: null };
}

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
    homeMeetWeights: division === 'home' ? { ...DEMO_CAPS.home.weights } : null,
    homeWeights: division === 'home' ? DEMO_HOME_WEIGHTS : [],
    cornerToken: newCornerToken(),
  }).returning();
  const o = demoOpener(division, 'squat', lifter.units);
  const [attempt] = await db.insert(attempts).values({ lifterId: lifter.id, meetId: meet.id, lift: 'squat', number: 1, weight: o.weight, repsDeclared: o.reps }).returning();
  return { lifter, attempt, meet };
}

/** A corner page's token (5.4): 16 url-safe random characters. */
export const newCornerToken = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString('base64url');
};

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
export const countDemoRun = (db: Db, lifterId: string, attemptId: string, sample: boolean, lift?: Lift) =>
  logEvent(db, 'demo_run', { lifter_id: lifterId, sample, ...(lift ? { lift } : {}) }, attemptId);

type SampleClip = { id: string; kind: 'good' | 'no' | 'close'; file: string; credit: string; meet?: { lift: Lift; reps: number; command_times: Record<string, number> } };
const CLIPS = samples.clips as SampleClip[];
/** The squat's sample lifts for the demo, in the order they cycle (5.36). */
export const DEMO_SAMPLES = CLIPS.filter(c => c.meet?.lift === 'squat');
/**
 * A lift's sample lifts (5.36): its own licensed clips once they're found; until then, the
 * squat's good clip alone. The server judges a clip as the lift it shows (its command times).
 */
export const demoSamplesFor = (lift: Lift): SampleClip[] => {
  const own = CLIPS.filter(c => c.meet?.lift === lift);
  return own.length ? own : DEMO_SAMPLES.filter(c => c.kind === 'good');
};

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
  const clips = demoSamplesFor(a.lift);
  if (!clips.length) return { status: 409 as const, error: 'no sample lifts' };
  // each lift cycles its own clips: good, no lift, then the close call once it's found
  const [{ n }] = await db.execute<{ n: number }>(sql`select count(*) as n from ${events}
    where kind = 'demo_run' and detail->>'lifter_id' = ${lifterId} and (detail->>'sample')::boolean and coalesce(detail->>'lift', 'squat') = ${a.lift}`);
  const clip = clips[Number(n) % clips.length];
  const key = keys.meetVideo(a.meetId, a.lifterId, a.id, 'mp4');
  await store.copy(keys.sample(clip.file), key);
  // 5.36: a sample standing in for a Home attempt is judged on the clip's reps ("25 × 1")
  await db.update(attempts).set({ videoKey: key, status: 'uploading', isSampleClip: true, recordedAt: new Date(), repsDeclared: a.repsDeclared ? clip.meet!.reps : null })
    .where(eq(attempts.id, a.id));
  await countDemoRun(db, lifterId, a.id, true, a.lift);
  const r = await markUploaded(db, store, a.id, clip.meet!.command_times);
  if (r.status !== 200) return r;
  return { status: 200 as const, attempt: { id: a.id, status: r.attempt.status }, sample: { id: clip.id, kind: clip.kind, credit: clip.credit, reps: clip.meet!.reps, lift: clip.meet!.lift } };
}

export { sampleRepsLine } from '@/lib/stage/meet-words';

/** When the made-up history's best set was judged: five days before now. */
export const demoCapAt = (now = new Date()) => new Date(now.getTime() - 5 * 86_400_000);
/** That day, Eastern ("Nov 3"). */
export const demoCapDate = (now = new Date()) =>
  demoCapAt(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

const PAST: Record<Lift, string> = { squat: 'squatted', bench: 'benched', deadlift: 'deadlifted' };

/** The attempt card's because line (5.25 step 1, judged), from the demo's made-up caps. */
export function demoBecause(division: Division, lift: Lift, units: Units = 'lb', now = new Date(), declared?: number | null) {
  const date = demoCapDate(now);
  if (division === 'home') {
    const same = declared === DEMO_CAPS.home.reps;
    return `You did ${DEMO_CAPS.home.reps} at ${DEMO_CAPS.home.weights[lift]} ${units} with white lights on ${date}. ${capSentence('home', same)}`;
  }
  const same = declared === DEMO_CAPS.barbell[lift];
  return `You ${PAST[lift]} ${DEMO_CAPS.barbell[lift]} for 3 with white lights on ${date}. ${capSentence('barbell', same)}`;
}
