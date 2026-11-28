// Email under the day's limit (The Playner, Nov 28): sign-in links, then "Soo just read your name",
// then the roll call's, then the replay's; at the limit, /ops says so and nothing more goes that day.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { emails, lifters, meets, readouts } from '../../web/db/schema';
import { emailLimitLine, queueEmail, resendSender, sendDue, type Sender } from '../../web/lib/email';
import { readoutsSeen, recordReadout, recentReadouts } from '../../web/lib/host-data';
import { freshDb, URL_ } from './setup';

describe.skipIf(!URL_)('the email limit', () => {
  let db: Db, drop: () => Promise<void>;
  beforeAll(async () => { ({ db, drop } = await freshDb(4)); });
  afterAll(async () => drop?.());

  async function her(n: string) {
    const [l] = await db.insert(lifters).values({ cardName: n, email: `${n.toLowerCase()}@first-meet.invalid`, division: 'barbell' }).returning();
    return l;
  }

  it('sends in kind order up to the limit, says so on /ops, and sends nothing more that day', async () => {
    const l = await her('Ana');
    const env = { EMAIL_DAY_LIMIT: '3' } as NodeJS.ProcessEnv;
    const at = new Date('2027-02-27T01:00:00Z');
    // queued last-first, so only the kind order can put them right
    for (const kind of ['replay', 'rollcall', 'rollcall', 'read', 'signin'] as const) {
      await queueEmail(db, { lifterId: l.id, kind, subject: kind, body: kind, sendAfter: new Date(at.getTime() - 1000) });
    }
    const out: string[] = [];
    const send: Sender = async m => { out.push(m.subject); return { ok: true, id: `re_${out.length}` }; };
    expect(await emailLimitLine(db, at, env)).toBeNull();
    const r = await sendDue(db, send, at, env);
    expect(out).toEqual(['signin', 'read', 'rollcall']);
    expect(r).toMatchObject({ sent: 3, limited: true });
    expect(await emailLimitLine(db, at, env)).toBe('Email limit reached today: 2 not sent.');
    // later the same day: nothing
    await sendDue(db, send, new Date(at.getTime() + 3_600_000), env);
    expect(out).toHaveLength(3);
    // the next UTC day: the rest go, oldest kind first
    await sendDue(db, send, new Date('2027-02-28T00:00:05Z'), env);
    expect(out).toEqual(['signin', 'read', 'rollcall', 'rollcall', 'replay']);
  });

  it("stops for the day when Resend's quota is used, before our own count", async () => {
    const l = await her('Bea');
    const at = new Date('2027-03-05T12:00:00Z');
    await queueEmail(db, { lifterId: l.id, kind: 'read', subject: 'a', body: 'a', sendAfter: at });
    await queueEmail(db, { lifterId: l.id, kind: 'read', subject: 'b', body: 'b', sendAfter: at });
    let calls = 0;
    const fetcher = (async () => { calls++; return new Response('{"name":"daily_quota_exceeded","message":"You have reached your daily email sending quota."}', { status: 429 }); }) as typeof fetch;
    const r = await sendDue(db, resendSender('re_test', fetcher), at, {} as NodeJS.ProcessEnv);
    expect(r).toMatchObject({ sent: 0, limited: true });
    expect(calls).toBe(1);
    expect(await emailLimitLine(db, at, {} as NodeJS.ProcessEnv)).toBe('Email limit reached today: 2 not sent.');
    await sendDue(db, resendSender('re_test', fetcher), new Date(at.getTime() + 60_000), {} as NodeJS.ProcessEnv);
    expect(calls).toBe(1);
  });

  it('with no key, logs and marks each one, and sends nothing', async () => {
    const l = await her('Cleo');
    const at = new Date('2027-03-10T12:00:00Z');
    const id = await queueEmail(db, { lifterId: l.id, kind: 'read', subject: 'c', body: 'c', sendAfter: at });
    const r = await sendDue(db, null, at, {} as NodeJS.ProcessEnv);
    expect(r.noKey).toBeGreaterThanOrEqual(1);
    const [e] = await db.select().from(emails).where(eq(emails.id, id));
    expect(e.status).toBe('no_key');
  });
});

describe.skipIf(!URL_)('a read-out (5.29)', () => {
  let db: Db, drop: () => Promise<void>;
  beforeAll(async () => { ({ db, drop } = await freshDb(4)); });
  afterAll(async () => drop?.());

  it('queues her email 50 s on; her phone showing it first stops it', async () => {
    const [m] = await db.insert(meets).values({ slug: 'feb', name: 'Feb', kind: 'real', status: 'open', streamStartedAt: new Date('2027-02-27T01:00:00Z') }).returning();
    const [l] = await db.insert(lifters).values({ cardName: 'Dee', email: 'dee@first-meet.invalid', division: 'barbell', meetId: m.id }).returning();
    const now = new Date('2027-02-27T02:04:00Z');
    const r = await recordReadout(db, { meet: m, lifterId: l.id, kind: 'read' }, now);
    expect(r.streamOffsetS).toBe(3840);
    const [e] = await db.select().from(emails).where(eq(emails.readoutId, r.id));
    expect(e).toMatchObject({ kind: 'read', subject: 'Soo just read your name', status: 'waiting' });
    expect(e.body).toContain('Soo read your name at 9:04 pm Eastern. Watch the moment: ');
    expect(e.body).toContain(`/moment/${r.id}`);
    expect(e.sendAfter.getTime() - now.getTime()).toBe(50_000);
    expect(await recentReadouts(db, l.id, new Date(now.getTime() + 5000))).toMatchObject([{ id: r.id, kind: 'read', demo: false, name: 'Dee' }]);
    // someone else can't stop it
    const [other] = await db.insert(lifters).values({ cardName: 'Eve', division: 'barbell' }).returning();
    expect(await readoutsSeen(db, other.id, [r.id])).toBe(0);
    expect(await readoutsSeen(db, l.id, [r.id])).toBe(1);
    const [after] = await db.select().from(emails).where(eq(emails.readoutId, r.id));
    expect(after.status).toBe('seen');
    expect(await sendDue(db, async () => { throw new Error('sent'); }, new Date(now.getTime() + 60_000), {} as NodeJS.ProcessEnv)).toMatchObject({ sent: 0 });
  });

  it('a demo read-out is her phone\'s only', async () => {
    const [m] = await db.insert(meets).values({ slug: 'demo', name: 'Demo meet', kind: 'demo', status: 'open' }).returning();
    const [l] = await db.insert(lifters).values({ cardName: 'Demo lifter', division: 'barbell', isDemo: true, meetId: m.id }).returning();
    const r = await recordReadout(db, { meet: m, lifterId: l.id, kind: 'rollcall' });
    expect(await db.select().from(emails).where(eq(emails.readoutId, r.id))).toHaveLength(0);
    expect((await db.select().from(readouts).where(eq(readouts.id, r.id)))[0].streamOffsetS).toBeNull();
    expect(await recentReadouts(db, l.id)).toMatchObject([{ demo: true, watch: null }]);
  });
});
