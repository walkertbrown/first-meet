// The next block's start (plan 3.2, 5.24, item 76): read from the next real meet whose block hasn't
// started yet, so Walker's answer on #spring-date is a change to a row, not to the code.
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { meets } from '@/db/schema';

/** The real meets item 76 gives dates to: Winter's block, and the Spring 2027 meet (the team's pick on #spring-date). */
export const REAL_MEETS = [
  {
    slug: 'winter-2027', name: 'Winter 2027', blockStartsOn: '2026-12-07',
    opensAt: new Date('2027-02-26T11:00:00Z'), closesAt: new Date('2027-02-27T23:00:00Z'), liveAt: new Date('2027-02-28T01:00:00Z'),
  },
  {
    slug: 'spring-2027', name: 'Spring 2027', blockStartsOn: '2027-03-01',
    opensAt: new Date('2027-05-21T10:00:00Z'), closesAt: new Date('2027-05-22T22:00:00Z'), liveAt: new Date('2027-05-23T00:00:00Z'),
  },
] as const;

/** Adds the real meets if they're missing, and Winter's block date if its row has none. Never changes a date already set. */
export async function ensureRealMeets(db: Db) {
  for (const m of REAL_MEETS) {
    const flightHourCutoffAt = new Date(m.opensAt.getTime() - 72 * 3_600_000);
    await db.insert(meets).values({ ...m, kind: 'real', status: 'upcoming', flightHourCutoffAt }).onConflictDoNothing();
    await db.update(meets).set({ blockStartsOn: m.blockStartsOn }).where(and(eq(meets.slug, m.slug), isNull(meets.blockStartsOn)));
    await db.update(meets).set({ flightHourCutoffAt }).where(and(eq(meets.slug, m.slug), isNull(meets.flightHourCutoffAt)));
  }
}

/** Today in Eastern, as YYYY-MM-DD. */
export const easternDay = (now: Date) => now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** "Monday, March 1": a date-only value, written without moving it across a time zone. */
export const blockDateWords = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** The next block's start in words, or "soon" when no real meet's block is still ahead. */
export async function nextBlockStarts(db: Db, now = new Date()): Promise<string> {
  const [m] = await db.select({ day: meets.blockStartsOn }).from(meets)
    .where(and(eq(meets.kind, 'real'), gt(meets.blockStartsOn, easternDay(now))))
    .orderBy(asc(meets.blockStartsOn)).limit(1);
  return m?.day ? blockDateWords(m.day) : 'soon';
}
