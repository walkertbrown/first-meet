// Meet week (plan 5.23): from the Monday of week 12 until the window opens. Her openers (3.8,
// 3.8a), the flight-time picker and its hour, decided at the meet's flight_hour_cutoff_at (Tuesday
// 6 am Eastern for a real meet, 3.2), her corner link, and the checklist's loading lines. The page
// is web/app/meet-week.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, flightHourVotes, flights, lifters, meets, type Lift } from '@/db/schema';
import {
  LIFTS, barWeight, barbellOpenerChoices, homeOpenerChoices, homeWeightChoices,
  type HomeWeightChoice, type Units,
} from '@/lib/meet';
import { MEET_WEEK_SLOTS, SLOT_COUNT, flightWinner, hourSetAt, inMeetWeek, slotOf, slotStart } from '@/lib/meet-week-words';
import { type LifterRow, lifterCaps, meetAttempts, trainingSets } from '@/lib/meet-flow';
import { newCornerToken } from '@/lib/demo';

export * from '@/lib/meet-week-words';

// ---------- the view ----------

export type BarbellOpenerView = {
  lift: Lift; division: 'barbell'; cap: number; judged: boolean;
  /** suggested first, then one and two small steps lighter */
  choices: number[]; picked: number; saved: boolean; locked: boolean;
};
export type HomeOpenerView = {
  lift: Lift; division: 'home';
  weights: (HomeWeightChoice & { openers: number[] })[];
  /** the weight that scores most (SCORES MOST) */
  best: number | null;
  pickedWeight: number | null; pickedReps: number | null; saved: boolean; locked: boolean;
};
export type OpenerView = BarbellOpenerView | HomeOpenerView;

export type MeetWeekView = {
  meetId: string; meetName: string; opensAt: Date; closesAt: Date | null; units: Units; division: 'barbell' | 'home'; bar: number;
  openers: OpenerView[];
  flight: null | {
    /** the votes per slot, her flight's */
    counts: number[]; mine: number[];
    /** after the cutoff: the hour (a slot), or null when nobody ticked any */
    open: boolean; hour: number | null; setAt: Date;
    starts: Date[];
  };
  cornerToken: string;
};

export type MeetWeekPlace =
  | { kind: 'week'; view: MeetWeekView }
  | { kind: 'not-yet' } // before the Monday of week 12, or not in a real meet
  | { kind: 'weekend' }; // the window has opened

/** Where meet week stands for her, and what the page shows. */
export async function meetWeekPlace(db: Db, l: LifterRow, now = new Date()): Promise<MeetWeekPlace> {
  if (!l.meetId) return { kind: 'not-yet' };
  const [m] = await db.select().from(meets).where(eq(meets.id, l.meetId));
  if (!m || m.kind === 'demo' || !m.opensAt) return { kind: 'not-yet' };
  if (now >= m.opensAt) return { kind: 'weekend' };
  const blockStart = l.blockStart ?? m.blockStartsOn;
  if (!inMeetWeek(blockStart, m.opensAt, now)) return { kind: 'not-yet' };
  return { kind: 'week', view: await meetWeekView(db, l, m, now) };
}

async function meetWeekView(db: Db, l: LifterRow, m: typeof meets.$inferSelect, now: Date): Promise<MeetWeekView> {
  const units = l.units as Units;
  const openers = await openerViews(db, l);
  let cornerToken = l.cornerToken;
  if (!cornerToken) {
    cornerToken = newCornerToken();
    const [u] = await db.update(lifters).set({ cornerToken }).where(and(eq(lifters.id, l.id), isNull(lifters.cornerToken))).returning({ t: lifters.cornerToken });
    if (!u) [{ t: cornerToken }] = await db.select({ t: lifters.cornerToken }).from(lifters).where(eq(lifters.id, l.id)) as { t: string }[];
  }
  return {
    meetId: m.id, meetName: m.name, opensAt: m.opensAt!, closesAt: m.closesAt, units, division: l.division, bar: l.barWeight ?? barWeight(units),
    openers, flight: l.flightId ? await flightView(db, l.flightId, l.id, { opensAt: m.opensAt!, flightHourCutoffAt: m.flightHourCutoffAt }, now) : null,
    cornerToken: cornerToken!,
  };
}

/** Her flight's votes, and from the cutoff the hour, decided once on the first read at or after it. */
export async function flightView(db: Db, flightId: string, lifterId: string, m: { opensAt: Date; flightHourCutoffAt?: Date | null }, now = new Date()) {
  const opensAt = m.opensAt;
  const rows = await db.select({ lifterId: flightHourVotes.lifterId, slot: flightHourVotes.slot }).from(flightHourVotes).where(eq(flightHourVotes.flightId, flightId));
  const counts = MEET_WEEK_SLOTS.map((_, i) => rows.filter(r => r.slot === i).length);
  const mine = rows.filter(r => r.lifterId === lifterId).map(r => r.slot).sort((a, b) => a - b);
  const setAt = hourSetAt(m);
  const starts = MEET_WEEK_SLOTS.map((_, i) => slotStart(opensAt, i));
  if (now < setAt) return { counts, mine, open: true, hour: null, setAt, starts };
  const [f] = await db.select({ hour: flights.flightHour }).from(flights).where(eq(flights.id, flightId));
  let hour = slotOf(opensAt, f?.hour ?? null);
  if (hour < 0) {
    const w = flightWinner(counts);
    if (w !== null) {
      // saved once: the first read after the cutoff sets it, and it never moves
      await db.update(flights).set({ flightHour: starts[w] }).where(and(eq(flights.id, flightId), isNull(flights.flightHour)));
      const [g] = await db.select({ hour: flights.flightHour }).from(flights).where(eq(flights.id, flightId));
      hour = slotOf(opensAt, g?.hour ?? null);
    }
  }
  return { counts, mine, open: false, hour: hour < 0 ? null : hour, setAt, starts };
}

/** Each lift's opener choices, with what she saved and whether that lift is already lifted. */
export async function openerViews(db: Db, l: LifterRow): Promise<OpenerView[]> {
  const rows = await meetAttempts(db, l);
  const firstOf = (lift: Lift) => rows.find(a => a.lift === lift && a.number === 1);
  const units = l.units as Units;
  if (l.division === 'barbell') {
    const caps = await lifterCaps(db, l);
    const bar = l.barWeight ?? barWeight(units);
    return LIFTS.map(lift => {
      const c = caps[lift], a = firstOf(lift);
      const choices = barbellOpenerChoices(c.cap, lift, units, bar);
      return { lift, division: 'barbell' as const, cap: c.cap, judged: c.judged, choices, picked: a?.weight ?? choices[0], saved: !!a, locked: !!a && a.status !== 'declared' };
    });
  }
  const { judged, logged } = await trainingSets(db, l.id);
  return LIFTS.map(lift => {
    const { choices, best } = homeWeightChoices(lift, judged, logged, l.homeWeights);
    const a = firstOf(lift);
    const weights = choices.map(c => ({ ...c, openers: homeOpenerChoices(c.capReps) }));
    const pickedWeight = a?.weight ?? l.homeMeetWeights?.[lift] ?? best?.weight ?? null;
    const at = weights.find(w => w.weight === pickedWeight);
    return {
      lift, division: 'home' as const, weights, best: best?.weight ?? null, pickedWeight,
      pickedReps: a?.repsDeclared ?? at?.openers[0] ?? null, saved: !!a, locked: !!a && a.status !== 'declared',
    };
  });
}

// ---------- saving ----------

export type OpenerPick = { lift: Lift; weight: number; reps?: number | null };

/**
 * "Save my openers" (5.23): each lift's attempt 1, declared now so the platform starts there.
 * Checked against the same choices the page shows. A lift she has already lifted can't change;
 * the others can, until she lifts them. Home also saves the lift's meet weight (3.8a).
 */
export async function saveOpeners(db: Db, l: LifterRow, picks: OpenerPick[], now = new Date()): Promise<{ status: 200 } | { status: 409 | 422; error: string }> {
  const place = await meetWeekPlace(db, l, now);
  if (place.kind !== 'week') return { status: 409, error: 'meet week is not on' };
  if (!picks.length || picks.length > 3 || new Set(picks.map(p => p.lift)).size !== picks.length) return { status: 422, error: 'one pick per lift' };
  const views = place.view.openers;
  const rows: { lift: Lift; weight: number; reps: number | null }[] = [];
  for (const p of picks) {
    const v = views.find(x => x.lift === p.lift);
    if (!v) return { status: 422, error: 'not a lift' };
    if (v.locked) return { status: 409, error: `${p.lift} is already lifted` };
    if (v.division === 'barbell') {
      if (!v.choices.includes(p.weight)) return { status: 422, error: 'not one of the choices' };
      rows.push({ lift: p.lift, weight: p.weight, reps: null });
    } else {
      const w = v.weights.find(x => x.weight === p.weight);
      if (!w || typeof p.reps !== 'number' || !w.openers.includes(p.reps)) return { status: 422, error: 'not one of the choices' };
      rows.push({ lift: p.lift, weight: p.weight, reps: p.reps });
    }
  }
  for (const r of rows) {
    await db.insert(attempts).values({ lifterId: l.id, meetId: l.meetId!, lift: r.lift, number: 1, weight: r.weight, repsDeclared: r.reps })
      .onConflictDoUpdate({
        target: [attempts.lifterId, attempts.meetId, attempts.lift, attempts.number],
        set: { weight: r.weight, repsDeclared: r.reps },
        setWhere: sql`${attempts.status} = 'declared'`,
      });
  }
  if (l.division === 'home') {
    const merged = { ...(l.homeMeetWeights ?? {}), ...Object.fromEntries(rows.map(r => [r.lift, r.weight])) };
    await db.update(lifters).set({ homeMeetWeights: merged }).where(eq(lifters.id, l.id));
  }
  return { status: 200 };
}

/** Her ticks (5.23): every hour that works, replacing the ones before. Only until the hour is set. */
export async function saveVotes(db: Db, l: LifterRow, slots: number[], now = new Date()): Promise<{ status: 200; counts: number[]; mine: number[] } | { status: 409 | 422; error: string }> {
  const place = await meetWeekPlace(db, l, now);
  if (place.kind !== 'week' || !place.view.flight || !l.flightId) return { status: 409, error: 'no flight to pick for' };
  if (!place.view.flight.open) return { status: 409, error: 'the hour is set' };
  const want = [...new Set(slots)];
  if (want.some(s => !Number.isInteger(s) || s < 0 || s >= SLOT_COUNT)) return { status: 422, error: 'not one of the hours' };
  await db.transaction(async tx => {
    await tx.delete(flightHourVotes).where(and(eq(flightHourVotes.flightId, l.flightId!), eq(flightHourVotes.lifterId, l.id)));
    if (want.length) await tx.insert(flightHourVotes).values(want.map(slot => ({ flightId: l.flightId!, lifterId: l.id, slot })));
  });
  const [m] = await db.select({ opensAt: meets.opensAt, flightHourCutoffAt: meets.flightHourCutoffAt }).from(meets).where(eq(meets.id, l.meetId!));
  const f = await flightView(db, l.flightId, l.id, { opensAt: m.opensAt!, flightHourCutoffAt: m.flightHourCutoffAt }, now);
  return { status: 200, counts: f.counts, mine: f.mine };
}
