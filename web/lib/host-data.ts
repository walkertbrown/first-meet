// The host desk's data (plan 5.35, 5.29, 5.36): the meet's lifters as the board sees them, the
// read-outs (Soo's "Read" and the roll call's crossings), what each one tells her phone, and its email
// when her phone never showed it.
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, emails, lifters, meets, readouts } from '@/db/schema';
import { DEMO_SLUG } from '@/lib/demo';
import { queueEmail } from '@/lib/email';
import type { HostLifter } from '@/lib/host';
import { nextSlot } from '@/lib/meet';
import { asMeetAttempt } from '@/lib/meet-flow';
import { publish } from '@/lib/queue';
import { SAMPLE_LIFTERS } from '@/lib/sample-meet';

export type MeetRow = typeof meets.$inferSelect;

/** The meet the desk is for: the latest real (or staging's test) meet that has opened; else the next one. */
export async function hostMeet(db: Db, now = new Date()): Promise<MeetRow | null> {
  const open = await db.select().from(meets)
    .where(and(inArray(meets.kind, ['real', 'test']), isNotNull(meets.opensAt), lte(meets.opensAt, now)))
    .orderBy(desc(meets.opensAt)).limit(1);
  if (open[0]) return open[0];
  const next = await db.select().from(meets).where(eq(meets.kind, 'real')).orderBy(asc(meets.opensAt)).limit(1);
  return next[0] ?? null;
}

/** Everyone in a meet, with her attempts, as the board and the desk see her. */
export async function meetLifters(db: Db, meetId: string, opts: { since?: Date } = {}): Promise<(HostLifter & { createdAt: Date })[]> {
  const people = await db.select().from(lifters).where(and(eq(lifters.meetId, meetId), sql`${lifters.deletedAt} is null`,
    opts.since ? gte(lifters.createdAt, opts.since) : undefined));
  if (!people.length) return [];
  const rows = await db.select().from(attempts).where(and(eq(attempts.meetId, meetId), inArray(attempts.lifterId, people.map(p => p.id))));
  const by = new Map<string, typeof rows>();
  for (const a of rows) by.set(a.lifterId, [...(by.get(a.lifterId) ?? []), a]);
  const [m] = await db.select({ liveAt: meets.liveAt, closesAt: meets.closesAt }).from(meets).where(eq(meets.id, meetId));
  const year = (m?.liveAt ?? m?.closesAt ?? new Date()).getUTCFullYear();
  return people.map(l => ({
    id: l.id, name: l.cardName, ageGroup: l.ageGroup, age: l.birthYear ? year - l.birthYear : null, division: l.division, units: l.units,
    hometown: l.hometown, sayIt: l.sayIt, line: l.whyLine, createdAt: l.createdAt,
    attempts: (by.get(l.id) ?? []).map(a => asMeetAttempt(a, l)),
  }));
}

/** Who already has a read-out of this kind in the meet. */
export async function readIds(db: Db, meetId: string, kind: 'read' | 'rollcall'): Promise<Set<string>> {
  const rows = await db.selectDistinct({ id: readouts.lifterId }).from(readouts).where(and(eq(readouts.meetId, meetId), eq(readouts.kind, kind)));
  return new Set(rows.map(r => r.id));
}

export const DEMO_DESK_DAYS = 7;

/**
 * /host/sample's lifters (5.36): demo lifters who totaled in the last 7 days, newest first, then the
 * sample meet's made-up lifters. A demo lifter counts once her nine are all judged.
 */
export async function sampleDeskLifters(db: Db, now = new Date()): Promise<{ demo: HostLifter[]; sample: HostLifter[]; meetId: string | null }> {
  const [m] = await db.select().from(meets).where(eq(meets.slug, DEMO_SLUG));
  let demo: HostLifter[] = [];
  if (m) {
    const since = new Date(now.getTime() - DEMO_DESK_DAYS * 86_400_000);
    const list = await meetLifters(db, m.id, { since });
    demo = list.filter(l => !nextSlot(l.attempts) && l.attempts.every(a => a.status === 'judged'))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(({ createdAt: _, ...l }) => l);
  }
  return { demo, sample: SAMPLE_LIFTERS, meetId: m?.id ?? null };
}

// ---------- the words (5.29) ----------

export const timeWords = (at: Date) => at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).toLowerCase();

export function readoutEmail(kind: 'read' | 'rollcall', at: Date, link: string) {
  return {
    subject: kind === 'read' ? 'Soo just read your name' : "You were on Soo's live",
    body: `During tonight's meet night, ${kind === 'read' ? 'Soo read your name' : 'your name and total crossed the screen'} at ${timeWords(at)} Eastern. Watch the moment: ${link}`,
  };
}

export const appUrl = (env = process.env) => (env.APP_URL ?? 'http://localhost:3100').replace(/\/$/, '');
export const momentLink = (readoutId: string, env = process.env) => `${appUrl(env)}/moment/${readoutId}`;

/** Where "Watch the moment" goes (5.29): the stream while live; the replay at the moment once saved; else null. */
export function momentHref(m: Pick<MeetRow, 'streamVideoId' | 'replayVideoId' | 'streamStartedAt'>, at: Date): string | null {
  if (m.replayVideoId) {
    const t = m.streamStartedAt ? Math.max(0, Math.floor((at.getTime() - m.streamStartedAt.getTime()) / 1000) - 10) : 0;
    return `https://www.youtube.com/watch?v=${encodeURIComponent(m.replayVideoId)}&t=${t}s`;
  }
  if (m.streamVideoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(m.streamVideoId)}`;
  return null;
}
export const NO_REPLAY_YET = "The replay link comes once Soo's live is saved. We'll email you.";

// ---------- recording one ----------

/** How long her phone has to say it showed it before the email goes (5.29: within 1 minute). */
export const EMAIL_WAIT_MS = 50_000;

/**
 * A read-out: Soo's "Read", or her name crossing the middle of the band. Tells her phone at once;
 * a real lifter with an address also gets its email, unless her phone shows it first. A demo
 * lifter has no address, so a demo read-out is only ever her phone's.
 */
export async function recordReadout(db: Db, r: { meet: MeetRow; lifterId: string; kind: 'read' | 'rollcall' }, now = new Date()) {
  const offset = r.meet.streamStartedAt ? (now.getTime() - r.meet.streamStartedAt.getTime()) / 1000 : null;
  const [row] = await db.insert(readouts).values({ meetId: r.meet.id, lifterId: r.lifterId, kind: r.kind, at: now, streamOffsetS: offset }).returning();
  const demo = r.meet.kind === 'demo';
  if (!demo) {
    const [l] = await db.select({ email: lifters.email }).from(lifters).where(eq(lifters.id, r.lifterId));
    if (l?.email) {
      const e = readoutEmail(r.kind, now, momentLink(row.id));
      await queueEmail(db, { lifterId: r.lifterId, kind: r.kind, readoutId: row.id, subject: e.subject, body: e.body, sendAfter: new Date(now.getTime() + EMAIL_WAIT_MS) });
    }
  }
  await publish(db, { kind: 'readout', lifter_id: r.lifterId, readout_id: row.id, read_kind: r.kind, demo });
  return row;
}

/** Her phone showed these: their emails don't go. Only her own. */
export async function readoutsSeen(db: Db, lifterId: string, ids: string[]) {
  if (!ids.length) return 0;
  const mine = await db.select({ id: readouts.id }).from(readouts).where(and(eq(readouts.lifterId, lifterId), inArray(readouts.id, ids)));
  if (!mine.length) return 0;
  const r = await db.update(emails).set({ status: 'seen' })
    .where(and(eq(emails.status, 'waiting'), inArray(emails.readoutId, mine.map(m => m.id)))).returning({ id: emails.id });
  return r.length;
}

export type PhoneReadout = { id: string; kind: 'read' | 'rollcall'; demo: boolean; at: string; watch: string | null; name: string };

/** Her read-outs in the last minute, for a phone that (re)connects: the banner or sheet it missed. */
export async function recentReadouts(db: Db, lifterId: string, now = new Date()): Promise<PhoneReadout[]> {
  const rows = await db.select({ r: readouts, m: meets, name: lifters.cardName }).from(readouts)
    .innerJoin(meets, eq(meets.id, readouts.meetId)).innerJoin(lifters, eq(lifters.id, readouts.lifterId))
    .where(and(eq(readouts.lifterId, lifterId), gte(readouts.at, new Date(now.getTime() - 60_000))))
    .orderBy(asc(readouts.at));
  return rows.map(({ r, m, name }) => ({
    id: r.id, kind: r.kind, demo: m.kind === 'demo', at: r.at.toISOString(), name,
    watch: m.kind === 'demo' ? null : momentHref(m, r.at),
  }));
}
