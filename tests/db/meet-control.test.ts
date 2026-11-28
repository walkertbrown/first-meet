// Meet control (plan 5.35): open and close, "Make the board final" (awards written, only when ready),
// the replay's one email each, and the status message.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, awards, emails, lifters, meets } from '../../web/db/schema';
import { recordReadout } from '../../web/lib/host-data';
import { controlMeet, runControl, statusMessage } from '../../web/lib/meet-control';
import { platformOpen } from '../../web/lib/meet-flow';
import { LIFTS } from '../../web/lib/meet';
import { freshDb, URL_ } from './setup';

describe.skipIf(!URL_)('meet control', () => {
  let db: Db, drop: () => Promise<void>;
  beforeAll(async () => { ({ db, drop } = await freshDb(4)); });
  afterAll(async () => drop?.());

  const opens = new Date('2027-02-26T11:00:00Z'), closes = new Date('2027-02-27T23:00:00Z');
  async function meet(slug: string, status: 'upcoming' | 'open' | 'final' = 'upcoming') {
    const [m] = await db.insert(meets).values({ slug, name: 'Winter 2027', kind: 'real', status, opensAt: opens, closesAt: closes }).returning();
    return m;
  }
  async function totaled(meetId: string, name: string, call: 'white' | 'close_call' = 'white') {
    const [l] = await db.insert(lifters).values({ cardName: name, email: `${name.toLowerCase()}@first-meet.invalid`, division: 'barbell', meetId, birthYear: 1990 }).returning();
    await db.insert(attempts).values(LIFTS.flatMap(lift => [1, 2, 3].map(number => ({
      lifterId: l.id, meetId, lift, number, weight: 100 + number * 10,
      status: call === 'close_call' && lift === 'deadlift' && number === 3 ? 'close_call' as const : 'judged' as const,
      call: call === 'close_call' && lift === 'deadlift' && number === 3 ? 'close' as const : 'white' as const,
      recordedAt: new Date(opens.getTime() + 3_600_000), judgedAt: new Date(opens.getTime() + 3_700_000),
    }))));
    return l;
  }

  it('works on the first meet not yet final', async () => {
    await meet('fall', 'final');
    const m = await meet('winter');
    expect((await controlMeet(db))?.id).toBe(m.id);
  });

  it('opens early by pulling the opening time to now, and closes with the status', async () => {
    const m = (await controlMeet(db))!;
    const now = new Date('2027-02-25T12:00:00Z');
    expect(platformOpen(m, now)).toBe(false);
    expect(await runControl(db, m, { do: 'open' }, now)).toEqual({ ok: true });
    let [r] = await db.select().from(meets).where(eq(meets.id, m.id));
    expect(r.opensAt).toEqual(now);
    expect(platformOpen(r, new Date(now.getTime() + 1000))).toBe(true);
    await runControl(db, r, { do: 'close' }, now);
    [r] = await db.select().from(meets).where(eq(meets.id, m.id));
    expect(platformOpen(r, new Date(now.getTime() + 1000))).toBe(false);
    await db.update(meets).set({ opensAt: opens, status: 'upcoming' }).where(eq(meets.id, m.id));
  });

  it('"Make the board final" waits for the clip deadline and close calls, then writes the awards', async () => {
    const m = (await controlMeet(db))!;
    await totaled(m.id, 'Ana');
    const cleo = await totaled(m.id, 'Cleo', 'close_call');
    const before = await runControl(db, m, { do: 'final' }, new Date(closes.getTime() + 3_600_000));
    expect(before).toMatchObject({ ok: false });
    expect(before.note).toMatch(/^Clips can still arrive until /);
    const after = new Date(closes.getTime() + 7 * 3_600_000);
    expect(await runControl(db, m, { do: 'final' }, after)).toMatchObject({ ok: false });
    await db.update(attempts).set({ status: 'judged', call: 'white' }).where(eq(attempts.lifterId, cleo.id));
    expect(await runControl(db, m, { do: 'final' }, after)).toEqual({ ok: true });
    const [r] = await db.select().from(meets).where(eq(meets.id, m.id));
    expect(r.status).toBe('final');
    expect((await db.select().from(awards).where(eq(awards.meetId, m.id))).length).toBeGreaterThan(0);
  });

  it('the replay: one email each, her read before her crossing, never twice, never a demo lifter', async () => {
    const m = await meet('spring');
    const ana = await totaled(m.id, 'Bo');
    const [demo] = await db.insert(lifters).values({ cardName: 'Demo', division: 'barbell', isDemo: true, meetId: m.id }).returning();
    const live = new Date('2027-02-28T01:00:00Z');
    await db.update(meets).set({ streamStartedAt: live }).where(eq(meets.id, m.id));
    const mm = { ...m, streamStartedAt: live };
    await recordReadout(db, { meet: mm, lifterId: ana.id, kind: 'rollcall' }, new Date('2027-02-28T01:30:00Z'));
    const read = await recordReadout(db, { meet: mm, lifterId: ana.id, kind: 'read' }, new Date('2027-02-28T01:10:00Z'));
    await recordReadout(db, { meet: mm, lifterId: demo.id, kind: 'read' }, new Date('2027-02-28T01:12:00Z'));
    expect(await runControl(db, mm, { do: 'replay', id: 'dQw4w9WgXcQ' })).toEqual({ ok: true, note: '1 replay email on the way.' });
    const mail = await db.select().from(emails).where(eq(emails.kind, 'replay'));
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ lifterId: ana.id, readoutId: read.id, subject: "Soo's meet night replay is up" });
    expect(mail[0].body).toContain('Soo read your name at 8:10 pm Eastern. Watch the moment: ');
    expect(await runControl(db, mm, { do: 'replay', id: 'dQw4w9WgXcQ' })).toEqual({ ok: true });
    expect(await db.select().from(emails).where(eq(emails.kind, 'replay'))).toHaveLength(1);
  });

  it('the status message, and both blank clears it', async () => {
    const m = (await controlMeet(db))!;
    await runControl(db, m, { do: 'status', title: 'Judging is slow', sentence: 'Your lifts are saved.' });
    expect(await statusMessage(db)).toEqual({ title: 'Judging is slow', sentence: 'Your lifts are saved.' });
    await runControl(db, m, { do: 'status', title: ' ', sentence: '' });
    expect(await statusMessage(db)).toBeNull();
  });
});
