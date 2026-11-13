// Staging's test accounts (plan 3.1): /signin/test exists only when STAGING_TEST_SIGNIN is "on"
// AND the service isn't production's (RENDER_SERVICE_NAME). Otherwise a 404, so the setting
// copied to production by mistake still can't open it.
import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, flightHourVotes, flights, judgedSets, lifters, meets, sessions, type Division, type Lift } from '@/db/schema';
import { LIFTS } from '@/lib/meet';
import { DEMO_CAPS, DEMO_HOME_WEIGHTS } from '@/lib/demo';
import { easternDay } from '@/lib/next-block';
import { etWallToUtc } from '@/lib/meet-week-words';
import { CLIP_GRACE_MS, runClipDeadline } from '@/lib/meet-window';

export const PRODUCTION_SERVICE = 'first-meet-web';

export function testSigninOn(env: Record<string, string | undefined> = process.env, host?: string | null) {
  if (env.STAGING_TEST_SIGNIN !== 'on') return false;
  const service = env.RENDER_SERVICE_NAME;
  if (service) return service !== PRODUCTION_SERVICE;
  // No service name: go by the request's host, which must be staging's or this computer.
  const h = (host ?? '').toLowerCase().split(':')[0];
  return h.includes('staging') || h === 'localhost' || h === '127.0.0.1';
}

export const TEST_ACCOUNTS = {
  referee: { email: 'test-referee@first-meet.invalid', cardName: 'Test referee', isReferee: true, next: '/referee' },
  admin: { email: 'test-admin@first-meet.invalid', cardName: 'Test admin', isReferee: false, next: '/ops' },
  lifter: { email: 'test-lifter@first-meet.invalid', cardName: 'Test lifter', isReferee: false, next: '/referee' },
} as const;
/** Item 82: the two meet-week lifters, each in her division's flight of the test meet. */
export const MEET_WEEK_ACCOUNTS = {
  meetweek: { email: 'test-meetweek@first-meet.invalid', cardName: 'Test lifter', division: 'barbell' as Division, next: '/meet-week' },
  'meetweek-home': { email: 'test-meetweek-home@first-meet.invalid', cardName: 'Test lifter', division: 'home' as Division, next: '/meet-week' },
} as const;
export type TestWho = keyof typeof TEST_ACCOUNTS;
export type MeetWeekWho = keyof typeof MEET_WEEK_ACCOUNTS;
export const TEST_MEET_SLUG = 'test';
/** Her flightmates, never signed in. Ada and Bea tick Fri 7–8 am, Cleo and Dot Sat 9–10 am: a two-way tie. */
export const TEST_FLIGHTMATES = [
  { name: 'Ada', slot: 0 }, { name: 'Bea', slot: 0 }, { name: 'Cleo', slot: 5 }, { name: 'Dot', slot: 5 },
] as const;

/** Makes the account if it doesn't exist (keeping its role as the plan has it), and returns its id. */
export async function testAccount(db: Db, who: TestWho): Promise<{ id: string; next: string }> {
  const a = TEST_ACCOUNTS[who];
  const [row] = await db.insert(lifters).values({ email: a.email, cardName: a.cardName, isReferee: a.isReferee })
    .onConflictDoUpdate({ target: lifters.email, set: { isReferee: a.isReferee, deletedAt: null } })
    .returning({ id: lifters.id });
  return { id: row.id, next: a.next };
}


const DAY_MS = 86_400_000;
const addDays = (day: string, n: number) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/**
 * The test meet's dates (plan 3.1, item 82): this week is week 12, the window opens the next
 * Friday 6 am Eastern after now, closes that Saturday 6 pm, goes live that Saturday 8 pm, and the
 * flight hour is set an hour from now.
 */
export function testMeetDates(now: Date) {
  const today = easternDay(now);
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  let friday = addDays(today, (5 - weekday(today) + 7) % 7);
  if (etWallToUtc(friday, 6) <= now) friday = addDays(friday, 7);
  const saturday = addDays(friday, 1);
  const closesAt = etWallToUtc(saturday, 18);
  return {
    blockStartsOn: addDays(monday, -77),
    opensAt: etWallToUtc(friday, 6), closesAt, clipDeadlineAt: new Date(closesAt.getTime() + CLIP_GRACE_MS), liveAt: etWallToUtc(saturday, 20),
    flightHourCutoffAt: new Date(now.getTime() + 3_600_000),
  };
}

/** The demo's made-up history (5.36) as her own judged training: the triple at each cap, or 12 reps at each Home weight. */
async function seedHistory(db: Db, lifterId: string, division: Division, now: Date) {
  await db.delete(sessions).where(eq(sessions.lifterId, lifterId));
  await db.delete(judgedSets).where(eq(judgedSets.lifterId, lifterId));
  const at = new Date(now.getTime() - 5 * DAY_MS);
  const [s] = await db.insert(sessions).values({ lifterId, week: 11, day: 'A', startedAt: at, doneAt: at }).returning({ id: sessions.id });
  await db.insert(judgedSets).values(LIFTS.map((lift: Lift) => {
    const reps = division === 'home' ? DEMO_CAPS.home.reps : 3;
    const weight = division === 'home' ? DEMO_CAPS.home.weights[lift] : DEMO_CAPS.barbell[lift];
    return {
      sessionId: s.id, lifterId, movement: lift, weight, reps, allWhite: true, createdAt: at,
      lights: Array.from({ length: reps }, () => ({ call: 'white' as const, reason: null })),
    };
  }));
}

/**
 * Item 82: sets up the test meet afresh, puts her in her division's flight with four made-up
 * flightmates and their two-way tie, and clears her openers, meet weights and votes.
 */
export async function meetWeekAccount(db: Db, who: MeetWeekWho, now = new Date()): Promise<{ id: string; next: string }> {
  const a = MEET_WEEK_ACCOUNTS[who];
  const d = testMeetDates(now);
  const meetValues = { name: 'Test meet', kind: 'test' as const, status: 'upcoming' as const, ...d };
  const [m] = await db.insert(meets).values({ slug: TEST_MEET_SLUG, ...meetValues })
    .onConflictDoUpdate({ target: meets.slug, set: meetValues }).returning({ id: meets.id });
  let [f] = await db.select().from(flights).where(and(eq(flights.meetId, m.id), eq(flights.division, a.division)));
  if (!f) [f] = await db.insert(flights).values({ meetId: m.id, division: a.division, number: 1, blockStart: d.blockStartsOn }).returning();
  await db.update(flights).set({ flightHour: null, blockStart: d.blockStartsOn }).where(eq(flights.id, f.id));

  const her = {
    cardName: a.cardName, division: a.division, units: 'lb' as const, meetId: m.id, flightId: f.id, blockStart: d.blockStartsOn,
    homeWeights: a.division === 'home' ? DEMO_HOME_WEIGHTS : [], homeMeetWeights: null, isReferee: false, isDemo: false, deletedAt: null,
  };
  const [l] = await db.insert(lifters).values({ email: a.email, ...her })
    .onConflictDoUpdate({ target: lifters.email, set: her }).returning({ id: lifters.id });
  await db.delete(attempts).where(and(eq(attempts.lifterId, l.id), eq(attempts.meetId, m.id)));
  await seedHistory(db, l.id, a.division, now);

  const mates: string[] = [];
  for (const x of TEST_FLIGHTMATES) {
    const email = `test-flightmate-${x.name.toLowerCase()}${a.division === 'home' ? '-home' : ''}@first-meet.invalid`;
    const mate = { cardName: `${x.name} Test`, division: a.division, meetId: m.id, flightId: f.id, blockStart: d.blockStartsOn, isDemo: false, deletedAt: null };
    const [r] = await db.insert(lifters).values({ email, ...mate }).onConflictDoUpdate({ target: lifters.email, set: mate }).returning({ id: lifters.id });
    mates.push(r.id);
  }
  await db.delete(flightHourVotes).where(eq(flightHourVotes.flightId, f.id));
  await db.insert(flightHourVotes).values(TEST_FLIGHTMATES.map((x, i) => ({ flightId: f.id, lifterId: mates[i], slot: x.slot })));
  return { id: l.id, next: a.next };
}

/** "Set the test meet's flight hour now": the next read decides it, as Tuesday 6 am does for a real meet. */
export async function setTestHourNow(db: Db, now = new Date()) {
  await db.update(meets).set({ flightHourCutoffAt: now }).where(and(eq(meets.slug, TEST_MEET_SLUG), eq(meets.kind, 'test')));
}

const H = 3_600_000;
export type WindowButton = 'open-now' | 'close-now' | 'deadline-now';
export const WINDOW_BUTTONS: Record<WindowButton, string> = {
  'open-now': "Open the test meet's platform now",
  'close-now': "Close the test meet's platform now",
  'deadline-now': 'Run the clip deadline now',
};

/**
 * Item 86 (plan 3.1): the test meet's window by hand, so the closed page, the late-clip words and a
 * bomb out can be checked on staging. Open: opens now, closes in 2 h, the clip deadline 6 h after
 * that, live 2 h after the close, the flight hour the hour that holds now and its cutoff now. Close:
 * closes now, the deadline in 6 h, live in 2 h. Deadline: the deadline now, and its job runs at once.
 */
export async function testMeetWindow(db: Db, b: WindowButton, now = new Date()) {
  const [m] = await db.select().from(meets).where(and(eq(meets.slug, TEST_MEET_SLUG), eq(meets.kind, 'test')));
  if (!m) return false;
  if (b === 'open-now') {
    const closesAt = new Date(now.getTime() + 2 * H);
    await db.update(meets).set({ opensAt: now, closesAt, clipDeadlineAt: new Date(closesAt.getTime() + CLIP_GRACE_MS), liveAt: new Date(closesAt.getTime() + 2 * H), flightHourCutoffAt: now })
      .where(eq(meets.id, m.id));
    await db.update(flights).set({ flightHour: new Date(Math.floor(now.getTime() / H) * H) }).where(eq(flights.meetId, m.id));
  } else if (b === 'close-now') {
    await db.update(meets).set({ closesAt: now, clipDeadlineAt: new Date(now.getTime() + CLIP_GRACE_MS), liveAt: new Date(now.getTime() + 2 * H) })
      .where(eq(meets.id, m.id));
  } else {
    await db.update(meets).set({ clipDeadlineAt: now }).where(eq(meets.id, m.id));
    // "now" has passed by the time the job asks
    await runClipDeadline(db, new Date(now.getTime() + 1), m.id);
  }
  return true;
}

export async function testMeetExists(db: Db) {
  const [m] = await db.select({ id: meets.id }).from(meets).where(and(eq(meets.slug, TEST_MEET_SLUG), eq(meets.kind, 'test')));
  return !!m;
}


