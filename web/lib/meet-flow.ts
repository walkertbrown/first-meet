// The meet on the server (plan 3.8, 3.8a, 5.23–5.28): her caps from her training (or the demo's
// made-up history), where she is in the nine, the declare sheet's choices, declaring (checked
// against the same rules the sheet shows), and her total. The rules themselves are web/lib/meet.ts.
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, judgedSets, lifters, meets, sessions, sets, type Lift } from '@/db/schema';
import {
  LIFTS, barWeight, barbellCap, barbellDeclareChoices, barbellOpener, declareAllowed, homeCap, homeDeclareChoices, homeKind,
  homeLoad, homeOpener, homeWeightChoices, meetTotal, platformState, slotIndex,
  type DeclareChoice, type JudgedSet, type LoggedSet, type MeetAttempt, type Slot, type Units,
} from '@/lib/meet';
import { DEMO_CAPS, demoCapAt } from '@/lib/demo';
import { meetClosed, runClipDeadline } from '@/lib/meet-window';

export type LifterRow = typeof lifters.$inferSelect;
export type AttemptRow = typeof attempts.$inferSelect;

/** A lift's cap: the weight (Barbell) or the reps at her meet weight (Home), and where it came from. */
export type LiftCap = { cap: number; judged: boolean; at: Date | null; weight: number; kind: 'pair' | 'bell' | null };

/** Her nine (or fewer) attempts in this meet, in the meet's order. */
export async function meetAttempts(db: Db, l: Pick<LifterRow, 'id' | 'meetId'>): Promise<AttemptRow[]> {
  if (!l.meetId) return [];
  const rows = await db.select().from(attempts)
    .where(and(eq(attempts.lifterId, l.id), eq(attempts.meetId, l.meetId))).orderBy(asc(attempts.createdAt));
  return rows.sort((a, b) => slotIndex(a) - slotIndex(b));
}

/** Her training sets as the cap rules read them (3.8, 3.8a). */
export async function trainingSets(db: Db, lifterId: string): Promise<{ judged: JudgedSet[]; logged: LoggedSet[] }> {
  const js = await db.select({ s: judgedSets, week: sessions.week }).from(judgedSets)
    .leftJoin(sessions, eq(sessions.id, judgedSets.sessionId)).where(eq(judgedSets.lifterId, lifterId));
  const judged: JudgedSet[] = js.map(r => ({
    movement: r.s.movement, weight: r.s.weight ?? 0, reps: r.s.reps, allWhite: r.s.allWhite, lights: r.s.lights,
    week: r.week ?? 0, at: r.s.createdAt,
  }));
  // 3.8a counts the last judged set of weeks 8–11 up to its first red rep
  const last = new Map<string, JudgedSet>();
  for (const s of judged) {
    const k = `${s.movement}:${s.week}`;
    const b = last.get(k);
    if (!b || s.at > b.at) last.set(k, s);
  }
  for (const s of last.values()) s.lastSetOfWeek = true;
  const ls = await db.select({ s: sets, week: sessions.week, at: sessions.doneAt, startedAt: sessions.startedAt }).from(sets)
    .innerJoin(sessions, eq(sessions.id, sets.sessionId)).where(eq(sessions.lifterId, lifterId));
  const logged: LoggedSet[] = ls.filter(r => r.s.weight !== null && r.s.repsDone !== null && r.s.repsDone > 0).map(r => ({
    movement: r.s.movement, weight: r.s.weight!, reps: r.s.repsDone!, week: r.week, at: r.at ?? r.startedAt ?? new Date(0),
  }));
  return { judged, logged };
}

/** Her cap for each lift: the demo's made-up history, or her own training. */
export async function lifterCaps(db: Db, l: LifterRow): Promise<Record<Lift, LiftCap>> {
  if (l.isDemo) {
    const at = demoCapAt();
    return Object.fromEntries(LIFTS.map(lift => [lift, l.division === 'home'
      ? { cap: DEMO_CAPS.home.reps, judged: true, at, weight: l.homeMeetWeights?.[lift] ?? DEMO_CAPS.home.weights[lift], kind: homeKind(lift, DEMO_CAPS.home.weights[lift], l.homeWeights) }
      : { cap: DEMO_CAPS.barbell[lift], judged: true, at, weight: DEMO_CAPS.barbell[lift], kind: null }])) as Record<Lift, LiftCap>;
  }
  const { judged, logged } = await trainingSets(db, l.id);
  const units = l.units as Units;
  return Object.fromEntries(LIFTS.map(lift => {
    if (l.division === 'barbell') {
      const c = barbellCap(lift, judged, logged, units, l.barWeight ?? barWeight(units));
      return [lift, { cap: c.weight, judged: c.judged, at: c.at, weight: c.weight, kind: null }];
    }
    const w = l.homeMeetWeights?.[lift] ?? homeWeightChoices(lift, judged, logged, l.homeWeights).best?.weight ?? 0;
    const c = homeCap(lift, w, judged, logged);
    return [lift, { cap: c.reps, judged: c.judged, at: c.at, weight: w, kind: homeKind(lift, w, l.homeWeights) }];
  })) as Record<Lift, LiftCap>;
}

/** The suggested opener for a lift (3.8, 3.8a): the weight, and the reps on Home. */
export function openerFor(l: Pick<LifterRow, 'division' | 'units' | 'barWeight'>, lift: Lift, cap: LiftCap) {
  if (l.division === 'home') return { weight: cap.weight, reps: homeOpener(cap.cap) };
  const units = l.units as Units;
  return { weight: barbellOpener(cap.cap, lift, units, l.barWeight ?? barWeight(units)), reps: null };
}

export type DeclareSheet =
  | { kind: 'none'; why: 'done' | 'lifting' }
  | { kind: 'opener'; slot: Slot; weight: number; reps: number | null }
  | {
    kind: 'sheet'; slot: Slot; division: 'barbell' | 'home'; units: Units;
    /** her last attempt at this lift: its weight (Barbell) or reps (Home), and whether it was red */
    last: { value: number; red: boolean; reason: string | null; call: string | null };
    cap: LiftCap; choices: DeclareChoice[];
  };

/**
 * What "Declare your next attempt" offers now (5.26). Attempt 1 of a lift is her opener, declared
 * with no sheet ("Next: Bench press"). A red only counts as red once judged: while she waits, or
 * on a close call, the last attempt isn't red.
 */
export async function declareSheet(db: Db, l: LifterRow, list?: AttemptRow[]): Promise<DeclareSheet> {
  const rows = list ?? await meetAttempts(db, l);
  const st = platformState(rows);
  if (!st.toDeclare) return { kind: 'none', why: st.done ? 'done' : 'lifting' };
  const slot = st.toDeclare;
  const caps = await lifterCaps(db, l);
  const cap = caps[slot.lift];
  if (slot.number === 1) return { kind: 'opener', slot, ...openerFor(l, slot.lift, cap) };
  const prev = rows.find(a => a.lift === slot.lift && a.number === slot.number - 1)!;
  const red = prev.call === 'red';
  const division = l.division;
  const units = l.units as Units;
  const value = division === 'home' ? (prev.repsDeclared ?? 1) : prev.weight;
  const choices = division === 'home'
    ? homeDeclareChoices({ reps: value, red }, cap.cap)
    : barbellDeclareChoices({ weight: value, red }, cap.cap, slot.lift, units);
  return { kind: 'sheet', slot, division, units, last: { value, red, reason: prev.reason, call: prev.call }, cap, choices };
}

export type DeclareResult =
  | { status: 200; attempt: AttemptRow; slot: Slot }
  | { status: 409 | 422; error: string };

/**
 * Declares her next slot (5.26). `value` is the weight (Barbell) or reps (Home) she picked; an
 * opener takes none. The server checks it against the sheet's own choices, so a greyed card can't
 * be declared. Declaring twice (a double tap) gives back the attempt already declared.
 */
export async function declareNext(db: Db, l: LifterRow, value: number | null, now = new Date()): Promise<DeclareResult> {
  if (!l.meetId) return { status: 409, error: 'not in a meet' };
  const [m] = await db.select().from(meets).where(eq(meets.id, l.meetId));
  if (!m || !platformOpen(m, now)) return { status: 409, error: 'the platform is closed' };
  const sheet = await declareSheet(db, l);
  if (sheet.kind === 'none') return { status: 409, error: sheet.why === 'done' ? 'all nine are declared' : 'lift your current attempt first' };
  let weight: number, reps: number | null;
  if (sheet.kind === 'opener') ({ weight, reps } = sheet);
  else {
    if (value === null || !Number.isFinite(value) || !declareAllowed(sheet.choices, value)) return { status: 422, error: 'not one of the choices' };
    if (sheet.division === 'home') { weight = sheet.cap.weight; reps = value; } else { weight = value; reps = null; }
  }
  const slot = sheet.slot;
  const [made] = await db.insert(attempts).values({ lifterId: l.id, meetId: l.meetId, lift: slot.lift, number: slot.number, weight, repsDeclared: reps })
    .onConflictDoNothing().returning();
  if (made) return { status: 200, attempt: made, slot };
  const [had] = await db.select().from(attempts).where(and(eq(attempts.lifterId, l.id), eq(attempts.meetId, l.meetId),
    eq(attempts.lift, slot.lift), eq(attempts.number, slot.number)));
  return { status: 200, attempt: had, slot };
}

/**
 * The demo meet is always open; a real (or the test) meet from `opens_at` until `closes_at` (5.24).
 * The times decide it: nothing moves a meet's `status` to `open`, so it only shuts one that is
 * `closed` or `final` early.
 */
export const platformOpen = (m: Pick<typeof meets.$inferSelect, 'kind' | 'status' | 'opensAt' | 'closesAt'>, now = new Date()) =>
  m.kind === 'demo' || ((m.kind === 'real' || m.kind === 'test') && m.status !== 'closed' && m.status !== 'final'
    && !!m.opensAt && m.opensAt <= now && !!m.closesAt && now < m.closesAt);

/** An attempt as the total's rules see it, with a Home lift's load (3.8a). */
export function asMeetAttempt(a: AttemptRow, l: Pick<LifterRow, 'homeWeights'>): MeetAttempt {
  return {
    id: a.id, lift: a.lift, number: a.number, weight: a.weight, repsDeclared: a.repsDeclared, status: a.status, call: a.call,
    recordedAt: a.recordedAt, uploadedAt: a.uploadedAt, homeLoad: homeLoad(a.lift, a.weight, homeKind(a.lift, a.weight, l.homeWeights)),
  };
}

/**
 * Her total (5.28). Bombing out sets `free_entry_credit` (#bombout-free: yes), once. A demo
 * lifter's bomb out sets nothing: she has no account to add a meet to.
 */
export async function totalFor(db: Db, l: LifterRow, list?: AttemptRow[], now = new Date()) {
  const [m] = l.meetId ? await db.select().from(meets).where(eq(meets.id, l.meetId)) : [];
  const closed = !!m && meetClosed(m, now);
  // the clip deadline's job, on read (3.8): a clip still sending past it is sent too late
  if (closed && await runClipDeadline(db, now, m.id)) list = undefined;
  const rows = list ?? await meetAttempts(db, l);
  const t = meetTotal(rows.map(a => asMeetAttempt(a, l)), l.division, closed);
  if (t.kind === 'bombed' && !l.freeEntryCredit && !l.isDemo) await db.update(lifters).set({ freeEntryCredit: true }).where(eq(lifters.id, l.id));
  return t;
}
