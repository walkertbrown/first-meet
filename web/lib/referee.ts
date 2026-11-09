// Referees (plan 5.33): the close-call queue, one close call, saving the three lamps, and
// "Ask another referee". The demo referee (5.36) is a demo lifter deciding their own close call.
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, lifters, meets, reviews, type Light } from '@/db/schema';
import { logEvent, publish } from '@/lib/queue';

/** "Why it was sent" (5.33; command_times from plan item 53). */
export const WHY: Record<string, string> = {
  borderline_depth: 'Depth right on the line',
  visibility: 'Hard to see',
  short_pause: 'Short pause',
  hitch: 'Possible hitch',
  judge_unavailable: "The judge couldn't run",
  command_times: "The phone's commands didn't line up",
};

export const COMMAND_PROBLEM: Record<string, string> = {
  missing_soft: 'the ready call is missing',
  missing_start: 'the start command is missing',
  out_of_order: "they're out of order",
  outside_clip: 'one falls outside the clip',
  start_before_soft: 'the start command came before the ready call',
  not_a_number: "one of the times can't be read",
};

/** The red reasons a referee can give (3.5). */
export const REFEREE_REASONS = ['depth', 'no_lockout', 'no_pause', 'moved_feet', 'downward', 'weight_not_shown', 'not_whole_lift'] as const;
export type RefereeReason = (typeof REFEREE_REASONS)[number];

export type QueueRow = { attemptId: string; lift: string; division: string; reason: string | null; waitingS: number; secondOpinion: boolean };

/** Close calls waiting, oldest first. Demo close calls are the demo lifter's own, never in the queue. */
export async function closeCallQueue(db: Db, refereeId: string): Promise<QueueRow[]> {
  const rows = await db.execute<{ attempt_id: string; lift: string; division: string; reason: string | null; waiting_s: number; second: boolean }>(sql`
    select a.id as attempt_id, a.lift, l.division, a.reason,
      extract(epoch from now() - coalesce(a.judged_at, a.uploaded_at, a.created_at))::int as waiting_s,
      exists (select 1 from ${reviews} r where r.attempt_id = a.id and r.kind = 'second_opinion') as second
    from ${attempts} a
    join ${lifters} l on l.id = a.lifter_id
    join ${meets} m on m.id = a.meet_id
    where a.status = 'close_call' and m.kind <> 'demo'
      and not exists (select 1 from ${reviews} r where r.attempt_id = a.id and r.kind = 'second_opinion' and r.referee_id = ${refereeId})
    order by coalesce(a.judged_at, a.uploaded_at, a.created_at) asc
    limit 200`);
  return rows.map(r => ({ attemptId: r.attempt_id, lift: r.lift, division: r.division, reason: r.reason, waitingS: Number(r.waiting_s), secondOpinion: r.second }));
}

/** One close call, as a referee sees it: no lifter's name, only division, age group and lift. */
export async function closeCall(db: Db, attemptId: string) {
  const [row] = await db.select({ a: attempts, division: lifters.division, ageGroup: lifters.ageGroup, units: lifters.units, meetKind: meets.kind, lifterId: lifters.id })
    .from(attempts).innerJoin(lifters, eq(lifters.id, attempts.lifterId)).innerJoin(meets, eq(meets.id, attempts.meetId))
    .where(eq(attempts.id, attemptId));
  if (!row) return null;
  const asked = await db.select().from(reviews).where(and(eq(reviews.attemptId, attemptId), eq(reviews.kind, 'second_opinion'))).orderBy(desc(reviews.createdAt));
  return { ...row, secondOpinion: asked[0] ?? null };
}

/** Two whites is a good lift (5.25). */
export const callOf = (lights: Light[]) => (lights.filter(l => l === 'white').length >= 2 ? 'white' : 'red');

export type SaveInput = { lights: Light[]; reason?: string | null; rep?: number | null; note?: string | null };
type Who = { kind: 'referee'; id: string } | { kind: 'demo'; lifterId: string };

export async function saveLights(db: Db, attemptId: string, who: Who, input: SaveInput) {
  const c = await closeCall(db, attemptId);
  if (!c) return { status: 404 as const, error: 'no such attempt' };
  if (who.kind === 'demo' ? c.meetKind !== 'demo' || c.lifterId !== who.lifterId : c.meetKind === 'demo') return { status: 403 as const, error: 'not yours to decide' };
  if (c.a.status !== 'close_call') return { status: 409 as const, error: 'already decided' };
  if (who.kind === 'referee' && c.secondOpinion?.refereeId === who.id) return { status: 409 as const, error: 'you asked for a second look' };
  const lights = input.lights;
  if (!Array.isArray(lights) || lights.length !== 3 || lights.some(l => l !== 'white' && l !== 'red')) return { status: 400 as const, error: 'three lamps, white or red' };
  const call = callOf(lights);
  const reason = call === 'red' ? input.reason : null;
  if (call === 'red' && !REFEREE_REASONS.includes(reason as RefereeReason)) return { status: 400 as const, error: 'a red needs a reason card' };
  const home = !!c.a.repsDeclared;
  if (call === 'red' && home && !(Number.isInteger(input.rep) && input.rep! >= 1 && input.rep! <= c.a.repsDeclared!)) return { status: 400 as const, error: 'a red needs the rep' };
  const saved = await db.transaction(async tx => {
    const [u] = await tx.update(attempts).set({
      status: 'judged', call, lights, reason, refereeId: who.kind === 'referee' ? who.id : null,
      measures: sql`coalesce(${attempts.measures}, '{}'::jsonb) || ${JSON.stringify({ referee: true, close_reason: c.a.reason, ...(home && call === 'red' ? { red_rep: input.rep } : {}) })}::jsonb`,
    }).where(and(eq(attempts.id, attemptId), eq(attempts.status, 'close_call'))).returning();
    if (!u) return null;
    await tx.insert(reviews).values({ attemptId, refereeId: who.kind === 'referee' ? who.id : null, lights, reason, note: input.note?.slice(0, 500) ?? null, kind: 'close_call' });
    return u;
  });
  if (!saved) return { status: 409 as const, error: 'already decided' };
  await logEvent(db, 'referee_saved', { call, demo: who.kind === 'demo' || undefined, waited_s: c.a.judgedAt ? Math.round((Date.now() - new Date(c.a.judgedAt).getTime()) / 1000) : null }, attemptId);
  await publish(db, { kind: 'attempt', attempt_id: attemptId, lifter_id: c.lifterId, status: 'judged' });
  return { status: 200 as const, call, lights };
}

/** "Ask another referee": no lights saved; back in the queue marked "Second opinion". Only once. */
export async function askAnother(db: Db, attemptId: string, refereeId: string, note: string | null) {
  const c = await closeCall(db, attemptId);
  if (!c || c.meetKind === 'demo') return { status: 404 as const, error: 'no such close call' };
  if (c.a.status !== 'close_call') return { status: 409 as const, error: 'already decided' };
  if (c.secondOpinion) return { status: 409 as const, error: "a second referee's lights stand" };
  await db.insert(reviews).values({ attemptId, refereeId, lights: null, note: note?.slice(0, 500) || null, kind: 'second_opinion' });
  await publish(db, { kind: 'close_calls', attempt_id: attemptId });
  return { status: 200 as const };
}

export async function nextCloseCall(db: Db, refereeId: string) {
  return (await closeCallQueue(db, refereeId))[0]?.attemptId ?? null;
}

