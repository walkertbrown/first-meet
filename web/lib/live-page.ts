// Meet night, live (plan 5.6, 5.29): which part of the night it is, the words for the time, and the
// ticker's last 8 lights. Arithmetic first (no server code), then the one query.
import { and, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, lifters, meets } from '@/db/schema';
import type { LampCall } from '@/lib/board';
import type { TickerItem } from '@/components/ticker';

type LiveTimes = Pick<typeof meets.$inferSelect, 'liveAt' | 'streamStartedAt' | 'liveMinutes'>;
export type LivePhase = 'before' | 'live' | 'after';

/** When Soo's live ends: from when she went live (else the planned start), plus the live length. */
export function liveEnds(m: LiveTimes): Date | null {
  const from = m.streamStartedAt ?? m.liveAt;
  return from ? new Date(from.getTime() + m.liveMinutes * 60_000) : null;
}

/** Before `live_at`, from it, and after the live (5.6). With no `live_at` set it's always before. */
export function livePhase(m: LiveTimes, now = new Date()): LivePhase {
  if (!m.liveAt || (now < m.liveAt && !m.streamStartedAt)) return 'before';
  return now < liveEnds(m)! ? 'live' : 'after';
}

const clock = (d: Date, zone: string) => {
  const s = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone }).toLowerCase();
  return s.replace(':00 ', ' ');
};

/** "Saturday at 8 pm Eastern · 5 pm Pacific." */
export function liveWhen(liveAt: Date): string {
  const day = liveAt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
  return `${day} at ${clock(liveAt, 'America/New_York')} Eastern · ${clock(liveAt, 'America/Los_Angeles')} Pacific.`;
}

/** The stream box with no video ID yet: "Soo's live starts at 8 pm Eastern (5 pm Pacific)." */
export const noStreamYet = (liveAt: Date | null) => liveAt
  ? `Soo's live starts at ${clock(liveAt, 'America/New_York')} Eastern (${clock(liveAt, 'America/Los_Angeles')} Pacific).`
  : "Soo's live starts at 8 pm Eastern (5 pm Pacific).";

/** The countdown: "h:mm:ss", never below 0:00:00. */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
}

/** "WINTER 2027" from the meet's name. */
export const meetEyebrow = (name: string) => `MEET NIGHT · ${name.toUpperCase()}`;

/** A landed attempt's three mini lamps: the referee's lights, or three pulsing for a close call. */
export function tickerLamps(a: { call: 'white' | 'red' | 'close' | null; status: string; lights: ('white' | 'red')[] | null }): LampCall[] {
  if (a.call === 'close' || a.status === 'close_call') return ['pulse', 'pulse', 'pulse'];
  const l = a.lights?.length === 3 ? a.lights : a.call ? [a.call, a.call, a.call] : [];
  return l.length ? l : ['off', 'off', 'off'];
}

/** The ticker (5.6): the meet's last 8 lights, newest first. */
export async function latestLights(db: Db, meetId: string, n = 8): Promise<TickerItem[]> {
  const landed = sql`coalesce(${attempts.judgedAt}, ${attempts.uploadedAt})`;
  const rows = await db.select({
    id: attempts.id, lift: attempts.lift, number: attempts.number, weight: attempts.weight, reps: attempts.repsDeclared,
    call: attempts.call, status: attempts.status, lights: attempts.lights,
    name: lifters.cardName, division: lifters.division, units: lifters.units,
  }).from(attempts).innerJoin(lifters, eq(lifters.id, attempts.lifterId))
    .where(and(eq(attempts.meetId, meetId), isNull(lifters.deletedAt), or(isNotNull(attempts.call), eq(attempts.status, 'close_call'))))
    .orderBy(desc(landed)).limit(n);
  return rows.map(r => ({
    id: r.id, name: r.name, division: r.division, lift: r.lift, number: r.number, weight: r.weight,
    reps: r.division === 'home' ? r.reps : null, units: r.units, lamps: tickerLamps(r),
  }));
}
