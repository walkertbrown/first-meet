// Meet week on the server (plan 5.23, 3.1 item 82): the test meet and its lifters, saving openers
// (attempt 1, still declared, changeable until lifted), the Home meet weight, her ticks, and the
// flight's hour, decided once at the cutoff with the tie rule.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, flightHourVotes, flights, lifters, meets } from '../../web/db/schema';
import { meetWeekPlace, saveOpeners, saveVotes } from '../../web/lib/meet-week';
import { meetWeekAccount, setTestHourNow, testAccount, testMeetDates, testMeetExists, testMeetWindow, TEST_MEET_SLUG } from '../../web/lib/test-signin';
import { platformView } from '../../web/lib/platform-view';
import { boardFinalReady } from '../../web/lib/meet-window';
import { freshDb, URL_ } from './setup';

const NOW = new Date('2026-11-09T17:00:00Z'); // Monday noon Eastern
const later = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe('the test meet\'s dates (3.1, item 82)', () => {
  it('this week is week 12; the window opens the next Friday 6 am Eastern after now', () => {
    expect(testMeetDates(NOW)).toEqual({
      blockStartsOn: '2026-08-24',
      opensAt: new Date('2026-11-13T11:00:00Z'), closesAt: new Date('2026-11-14T23:00:00Z'), liveAt: new Date('2026-11-15T01:00:00Z'),
      clipDeadlineAt: new Date('2026-11-15T05:00:00Z'),
      flightHourCutoffAt: new Date('2026-11-09T18:00:00Z'),
    });
    // pressed on a Friday after 6 am, or a Sunday: the next week's window, the same week 12
    const fri = testMeetDates(new Date('2026-11-13T15:00:00Z'));
    expect(fri.opensAt).toEqual(new Date('2026-11-20T11:00:00Z'));
    expect(fri.blockStartsOn).toBe('2026-08-24');
    const sun = testMeetDates(new Date('2026-11-15T15:00:00Z'));
    expect(sun.opensAt).toEqual(new Date('2026-11-20T11:00:00Z'));
    expect(sun.blockStartsOn).toBe('2026-08-24');
    // in summer time
    expect(testMeetDates(new Date('2027-06-07T16:00:00Z')).opensAt).toEqual(new Date('2027-06-11T10:00:00Z'));
  });
});

describe.skipIf(!URL_)('meet week', () => {
  let db: Db, drop: () => Promise<void>;
  beforeAll(async () => { ({ db, drop } = await freshDb(4)); });
  afterAll(async () => drop?.());

  const her = async (id: string) => (await db.select().from(lifters).where(eq(lifters.id, id)))[0];

  it('the plain test accounts are never in a meet, and the test meet is made only by the meet-week buttons', async () => {
    expect(await testMeetExists(db)).toBe(false);
    const { id } = await testAccount(db, 'lifter');
    expect((await her(id)).meetId).toBeNull();
    expect(await testMeetExists(db)).toBe(false);
  });

  it('Barbell: in week 12 of the test meet, the demo\'s caps, four flightmates in a two-way tie, a corner link', async () => {
    const { id, next } = await meetWeekAccount(db, 'meetweek', NOW);
    expect(next).toBe('/meet-week');
    const l = await her(id);
    const [m] = await db.select().from(meets).where(eq(meets.slug, TEST_MEET_SLUG));
    expect(m).toMatchObject({ name: 'Test meet', kind: 'test', blockStartsOn: '2026-08-24' });
    expect(l).toMatchObject({ division: 'barbell', meetId: m.id, isDemo: false });
    const p = await meetWeekPlace(db, l, NOW);
    if (p.kind !== 'week') throw new Error(p.kind);
    expect(p.view.openers.map(o => o.division === 'barbell' && [o.lift, o.cap, o.judged, o.choices[0], o.saved])).toEqual([
      ['squat', 115, true, 100, false], ['bench', 75, true, 65, false], ['deadlift', 135, true, 120, false],
    ]);
    expect(p.view.flight).toMatchObject({ counts: [2, 0, 0, 0, 0, 2, 0, 0], mine: [], open: true, hour: null });
    expect(p.view.cornerToken).toMatch(/^[\w-]{16}$/);
    expect((await her(id)).cornerToken).toBe(p.view.cornerToken);
    const mates = await db.select({ name: lifters.cardName }).from(lifters).where(eq(lifters.flightId, l.flightId!));
    expect(mates.map(x => x.name).sort()).toEqual(['Ada Test', 'Bea Test', 'Cleo Test', 'Dot Test', 'Test lifter']);
  });

  it('before week 12 it isn\'t there; from the window it is the platform', async () => {
    const { id } = await meetWeekAccount(db, 'meetweek', NOW);
    const l = await her(id);
    expect((await meetWeekPlace(db, l, new Date('2026-11-09T04:00:00Z'))).kind).toBe('not-yet'); // Sunday 11 pm Eastern
    expect((await meetWeekPlace(db, l, new Date('2026-11-13T11:00:00Z'))).kind).toBe('weekend');
  });

  it('openers are attempt 1, still declared; changeable until that lift is lifted; only the choices shown', async () => {
    const { id } = await meetWeekAccount(db, 'meetweek', NOW);
    let l = await her(id);
    expect(await saveOpeners(db, l, [{ lift: 'squat', weight: 95 }], NOW)).toMatchObject({ status: 422 });
    expect(await saveOpeners(db, l, [{ lift: 'squat', weight: 100 }, { lift: 'squat', weight: 90 }], NOW)).toMatchObject({ status: 422 });
    expect(await saveOpeners(db, l, [{ lift: 'squat', weight: 100 }, { lift: 'bench', weight: 65 }, { lift: 'deadlift', weight: 120 }], NOW)).toEqual({ status: 200 });
    expect(await saveOpeners(db, l, [{ lift: 'squat', weight: 90 }], NOW)).toEqual({ status: 200 });
    const rows = await db.select().from(attempts).where(eq(attempts.lifterId, id));
    expect(rows.map(a => [a.lift, a.number, a.weight, a.status]).sort()).toEqual([
      ['bench', 1, 65, 'declared'], ['deadlift', 1, 120, 'declared'], ['squat', 1, 90, 'declared'],
    ]);
    // the squat is lifted: it stays; the bench can still change
    await db.update(attempts).set({ status: 'judged' }).where(and(eq(attempts.lifterId, id), eq(attempts.lift, 'squat')));
    l = await her(id);
    expect(await saveOpeners(db, l, [{ lift: 'squat', weight: 100 }], NOW)).toMatchObject({ status: 409 });
    expect(await saveOpeners(db, l, [{ lift: 'bench', weight: 60 }], NOW)).toEqual({ status: 200 });
    const p = await meetWeekPlace(db, l, NOW);
    if (p.kind !== 'week') throw new Error(p.kind);
    expect(p.view.openers.map(o => o.division === 'barbell' && [o.lift, o.picked, o.saved, o.locked])).toEqual([
      ['squat', 90, true, true], ['bench', 60, true, false], ['deadlift', 120, true, false],
    ]);
  });

  it('Home: a meet weight and reps from that weight\'s choices; the meet weight is kept', async () => {
    const { id } = await meetWeekAccount(db, 'meetweek-home', NOW);
    const l = await her(id);
    expect(l.homeMeetWeights).toBeNull();
    const p = await meetWeekPlace(db, l, NOW);
    if (p.kind !== 'week') throw new Error(p.kind);
    const squat = p.view.openers[0];
    if (squat.division !== 'home') throw new Error();
    expect(squat.weights.map(w => [w.weight, w.kind, w.capReps, w.score, w.openers])).toEqual([[25, 'bell', 12, 300, [10, 9, 8]]]);
    expect([squat.best, squat.pickedWeight, squat.pickedReps]).toEqual([25, 25, 10]);
    expect(await saveOpeners(db, l, [{ lift: 'squat', weight: 25, reps: 11 }], NOW)).toMatchObject({ status: 422 });
    expect(await saveOpeners(db, l, [{ lift: 'squat', weight: 25, reps: 9 }, { lift: 'deadlift', weight: 20, reps: 10 }], NOW)).toEqual({ status: 200 });
    expect((await her(id)).homeMeetWeights).toEqual({ squat: 25, deadlift: 20 });
    const [a] = await db.select().from(attempts).where(and(eq(attempts.lifterId, id), eq(attempts.lift, 'squat')));
    expect([a.weight, a.repsDeclared]).toEqual([25, 9]);
  });

  it('her ticks replace the ones before, until the hour is set; then the tie goes to the earliest slot, once', async () => {
    const { id } = await meetWeekAccount(db, 'meetweek', NOW);
    const l = await her(id);
    expect(await saveVotes(db, l, [9], NOW)).toMatchObject({ status: 422 });
    expect(await saveVotes(db, l, [5, 6], NOW)).toEqual({ status: 200, counts: [2, 0, 0, 0, 0, 3, 1, 0], mine: [5, 6] });
    expect(await saveVotes(db, l, [6], NOW)).toEqual({ status: 200, counts: [2, 0, 0, 0, 0, 2, 1, 0], mine: [6] });
    // the cutoff is an hour after the press
    expect(await saveVotes(db, l, [5], later(1))).toMatchObject({ status: 409 });
    let p = await meetWeekPlace(db, l, later(1));
    if (p.kind !== 'week') throw new Error(p.kind);
    expect(p.view.flight).toMatchObject({ open: false, hour: 0, counts: [2, 0, 0, 0, 0, 2, 1, 0] });
    const [f] = await db.select().from(flights).where(eq(flights.id, l.flightId!));
    expect(f.flightHour).toEqual(new Date('2026-11-13T12:00:00Z')); // Fri 7 am Eastern
    // decided once: votes that come in after don't move it
    await db.insert(flightHourVotes).values([{ flightId: l.flightId!, lifterId: id, slot: 5 }]);
    p = await meetWeekPlace(db, l, later(2));
    if (p.kind !== 'week') throw new Error(p.kind);
    expect(p.view.flight?.hour).toBe(0);
  });

  it('"Set the test meet\'s flight hour now" decides it on the next read; her own tick breaks the tie', async () => {
    const { id } = await meetWeekAccount(db, 'meetweek', NOW);
    const l = await her(id);
    await saveVotes(db, l, [5], NOW);
    await setTestHourNow(db, NOW);
    const p = await meetWeekPlace(db, l, NOW);
    if (p.kind !== 'week') throw new Error(p.kind);
    expect(p.view.flight).toMatchObject({ open: false, hour: 5 });
  });

  it('a press sets it all up afresh: openers, meet weights, votes and the hour cleared', async () => {
    const { id } = await meetWeekAccount(db, 'meetweek', NOW);
    let l = await her(id);
    await saveOpeners(db, l, [{ lift: 'bench', weight: 60 }], NOW);
    await saveVotes(db, l, [3], NOW);
    await setTestHourNow(db, NOW);
    await meetWeekPlace(db, l, NOW);
    await meetWeekAccount(db, 'meetweek', NOW);
    l = await her(id);
    expect(await db.select().from(attempts).where(eq(attempts.lifterId, id))).toEqual([]);
    const p = await meetWeekPlace(db, l, NOW);
    if (p.kind !== 'week') throw new Error(p.kind);
    expect(p.view.flight).toMatchObject({ counts: [2, 0, 0, 0, 0, 2, 0, 0], mine: [], open: true, hour: null });
    const [f] = await db.select().from(flights).where(eq(flights.id, l.flightId!));
    expect(f.flightHour).toBeNull();
  });

  it('item 86: open, close and the clip deadline by hand; the platform follows; the board waits for the deadline', async () => {
    const at = new Date('2026-11-09T17:20:00Z');
    const { id } = await meetWeekAccount(db, 'meetweek', at);
    await testMeetWindow(db, 'open-now', at);
    const meet = async () => (await db.select().from(meets).where(eq(meets.slug, TEST_MEET_SLUG)))[0];
    let m = await meet();
    expect(m).toMatchObject({ opensAt: at, closesAt: new Date(at.getTime() + 2 * 3_600_000),
      clipDeadlineAt: new Date(at.getTime() + 8 * 3_600_000), liveAt: new Date(at.getTime() + 4 * 3_600_000), flightHourCutoffAt: at });
    const l = await her(id);
    const [f] = await db.select().from(flights).where(eq(flights.id, l.flightId!));
    expect(f.flightHour).toEqual(new Date('2026-11-09T17:00:00Z'));
    expect((await platformView(db, l, m, new Date(at.getTime() + 1000))).kind).toBe('open');
    // she sends her opener; then the close, then the deadline before it ever arrives
    const [a] = await db.select().from(attempts).where(eq(attempts.lifterId, id));
    await db.update(attempts).set({ status: 'uploading' }).where(eq(attempts.id, a.id));
    const shut = new Date(at.getTime() + 60_000);
    await testMeetWindow(db, 'close-now', shut);
    m = await meet();
    expect(m).toMatchObject({ closesAt: shut, clipDeadlineAt: new Date(shut.getTime() + 6 * 3_600_000), liveAt: new Date(shut.getTime() + 2 * 3_600_000) });
    expect(await boardFinalReady(db, m, new Date(shut.getTime() + 1000))).toEqual({ ok: false, why: 'clip_deadline', line: 'Clips can still arrive until Monday 6:21 pm Eastern.' });
    const v = await platformView(db, l, m, new Date(shut.getTime() + 1000));
    expect(v.kind).toBe('done');
    const end = new Date(shut.getTime() + 120_000);
    await testMeetWindow(db, 'deadline-now', end);
    expect((await db.select().from(attempts).where(eq(attempts.id, a.id)))[0]).toMatchObject({ status: 'void', voidReason: 'upload_late' });
    m = await meet();
    expect(await boardFinalReady(db, m, new Date(end.getTime() + 1000))).toEqual({ ok: true });
    // nothing judged, nothing on its way: the closed page
    expect((await platformView(db, l, m, new Date(end.getTime() + 1000))).kind).toBe('closed');
  });

  it('nobody ticked any: no hour', async () => {
    const { id } = await meetWeekAccount(db, 'meetweek-home', NOW);
    const l = await her(id);
    await db.delete(flightHourVotes).where(eq(flightHourVotes.flightId, l.flightId!));
    await setTestHourNow(db, NOW);
    const p = await meetWeekPlace(db, l, NOW);
    if (p.kind !== 'week') throw new Error(p.kind);
    expect(p.view.flight).toMatchObject({ open: false, hour: null, counts: [0, 0, 0, 0, 0, 0, 0, 0] });
  });
});
