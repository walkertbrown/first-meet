// Her corner page on the server (plan 5.4): before, live, totaled, bombed and gone; clips only
// when she shared them by link; and cheers, one per sender per attempt, told to her live.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, cheers, flights, lifters, meets } from '../../web/db/schema';
import { ORDER } from '../../web/lib/meet';
import { cornerView } from '../../web/lib/corner-view';
import { cornerBlock, herCheers, markSeen, partsText, sendCheer, sendFlightCheer, waitingParts } from '../../web/lib/cheers';
import { listening, subscribe } from '../../web/lib/live';
import type { LiveEvent } from '../../web/lib/queue';
import { freshDb, URL_ } from './setup';

const plain = (s: string) => s.replace(/⁠/g, '').replace(/ /g, ' ');
const NOW = new Date('2027-02-26T18:00:00Z');

describe.skipIf(!URL_)('the corner page', () => {
  let db: Db, drop: () => Promise<void>;
  beforeAll(async () => { ({ db, drop } = await freshDb(4)); });
  afterAll(async () => drop?.());

  async function lifter(o: { opens?: Date; closes?: Date; kind?: 'real' | 'demo'; clip?: 'judges' | 'link' } = {}) {
    const [m] = await db.insert(meets).values({
      slug: `m-${randomBytes(4).toString('hex')}`, name: 'Winter 2027', kind: o.kind ?? 'real', status: 'open',
      opensAt: o.opens ?? new Date('2027-02-26T11:00:00Z'), closesAt: o.closes ?? new Date('2027-02-27T23:00:00Z'),
    }).returning();
    const token = randomBytes(12).toString('base64url');
    const [l] = await db.insert(lifters).values({ cardName: 'Dana', division: 'barbell', meetId: m.id, cornerToken: token, clipVisibility: o.clip ?? 'judges' }).returning();
    return { l, m, token };
  }
  async function lift(l: { id: string; meetId: string | null }, k: number, call: 'white' | 'red' | null, status = 'judged') {
    const s = ORDER[k];
    const [a] = await db.insert(attempts).values({
      lifterId: l.id, meetId: l.meetId!, lift: s.lift, number: s.number, weight: 100 + k * 5, status: status as 'judged',
      call, lights: call ? [call, call, call] : null, clipKey: `clips/${k}.webm`,
    }).returning();
    return a;
  }
  const sign = async (key: string) => `https://r2.test/${key}`;

  it('an unknown token is no page; a deleted account\'s page has closed', async () => {
    expect(await cornerView(db, 'no-such-token-here', NOW)).toBeNull();
    const { l, token } = await lifter();
    await db.update(lifters).set({ deletedAt: NOW }).where(eq(lifters.id, l.id));
    expect(await cornerView(db, token, NOW)).toEqual({ kind: 'gone' });
  });

  it('before meet weekend: her name and the weekend', async () => {
    const { token } = await lifter();
    const v = await cornerView(db, token, new Date('2027-02-01T12:00:00Z'));
    expect(v).toMatchObject({ kind: 'before', meetName: 'Winter 2027', name: 'Dana' });
    expect(v?.kind === 'before' && plain(v.title)).toBe('Dana lifts on Feb 26–27.');
  });

  it('on the weekend, before her first attempt: the not-started line', async () => {
    const { token } = await lifter();
    const v = await cornerView(db, token, NOW);
    expect(v).toMatchObject({ kind: 'live', list: [] });
    expect(v?.kind === 'live' && plain(v.notStarted ?? '')).toContain('The platform is open until Saturday 6 pm Eastern.');
  });

  it('live: sent attempts newest first, lights once judged, a referee\'s look, and nothing she hasn\'t sent', async () => {
    const { l, token } = await lifter();
    await lift(l, 0, 'white');
    await lift(l, 1, 'red');
    await lift(l, 2, null, 'close_call');
    await lift(l, 3, null, 'declared');
    const v = await cornerView(db, token, NOW, sign);
    if (v?.kind !== 'live') throw new Error(String(v?.kind));
    expect(v.list.map(r => plain(`${r.name} · ${r.weight} · ${r.state}`))).toEqual(['Squat 3 · 110 lb · close', 'Squat 2 · 105 lb · red', 'Squat 1 · 100 lb · white']);
    expect(v.list[1].lights).toEqual(['red', 'red', 'red']);
    expect(v.list.every(r => r.clip === null)).toBe(true); // her clips are for the judges
    expect(v.notStarted).toBeNull();
  });

  it('her clips show only when she shared them by link', async () => {
    const { l, token } = await lifter({ clip: 'link' });
    await lift(l, 0, 'white');
    const v = await cornerView(db, token, NOW, sign);
    expect(v?.kind === 'live' && v.list[0].clip).toBe('https://r2.test/clips/0.webm');
  });

  it('item 90: after the close, if she lifted none, her meet has closed; a clip on its way keeps it live', async () => {
    const after = new Date('2027-02-28T12:00:00Z');
    const none = await lifter();
    await lift(none.l, 0, null, 'declared');
    const v = await cornerView(db, none.token, after, sign);
    expect(v).toEqual({ kind: 'closed', meetName: 'Winter 2027', name: 'Dana', title: 'Dana\'s meet has closed.' });
    // a clip still sending holds it: not closed yet
    const sending = await lifter();
    await lift(sending.l, 0, null, 'uploading');
    expect((await cornerView(db, sending.token, new Date('2027-02-27T23:30:00Z'), sign))?.kind).not.toBe('closed');
    // one lift judged: her lifts, never the closed page
    const one = await lifter();
    await lift(one.l, 0, 'white');
    expect((await cornerView(db, one.token, after, sign))?.kind).not.toBe('closed');
    // the demo meet never closes
    const demo = await lifter({ kind: 'demo', closes: new Date('2027-02-27T23:00:00Z') });
    expect((await cornerView(db, demo.token, after, sign))?.kind).toBe('live');
  });

  it('totaled, and bombed', async () => {
    const t = await lifter();
    for (let k = 0; k < 9; k++) await lift(t.l, k, 'white');
    expect(await cornerView(db, t.token, NOW)).toMatchObject({ kind: 'totaled', total: '375', unit: 'lb' });
    const b = await lifter();
    for (let k = 0; k < 9; k++) await lift(b.l, k, ORDER[k].lift === 'bench' ? 'red' : 'white');
    expect(await cornerView(db, b.token, NOW)).toMatchObject({ kind: 'bombed' });
  });

  it('a cheer: kept once per sender per attempt, and told to her live', async () => {
    const { l, token } = await lifter();
    const a = await lift(l, 0, 'white');
    const heard: LiveEvent[] = [];
    const stop = subscribe(db, e => { heard.push(e); });
    await listening(); // or the first cheer can go out before the LISTEN is in place
    try {
      expect(await sendCheer(db, token, { attempt_id: a.id, kind: 'strong', name: ' Mary  Jo ' })).toEqual({ status: 200, kind: 'strong' });
      expect((await sendCheer(db, token, { attempt_id: a.id, kind: 'white_lights', name: 'Mary Jo' })).status).toBe(409);
      expect((await sendCheer(db, token, { attempt_id: a.id, kind: 'got_this', name: 'Ana' })).status).toBe(200);
      expect((await sendCheer(db, token, { attempt_id: a.id, kind: 'see_you' })).status).toBe(200);
      const kept = await db.select().from(cheers).where(eq(cheers.toLifterId, l.id));
      expect(kept.map(c => `${c.fromCornerName ?? '-'} ${c.kind}`).sort()).toEqual(['- see_you', 'Ana got_this', 'Mary Jo strong']);
      expect(kept.every(c => c.attemptId === a.id)).toBe(true);
      for (let i = 0; i < 20 && heard.filter(e => e.kind === 'cheer').length < 3; i++) await new Promise(r => setTimeout(r, 50));
      expect(heard.filter(e => e.kind === 'cheer')).toContainEqual({ kind: 'cheer', lifter_id: l.id, attempt_id: a.id, cheer: 'strong', name: 'Mary Jo' });
    } finally { stop(); }
  });

  it('no cheer on an attempt that isn\'t hers, isn\'t sent, or a page that has closed', async () => {
    const one = await lifter(), two = await lifter();
    const hers = await lift(one.l, 0, 'white');
    const notSent = await lift(one.l, 1, null, 'declared');
    expect((await sendCheer(db, two.token, { attempt_id: hers.id, kind: 'strong' })).status).toBe(404);
    expect((await sendCheer(db, one.token, { attempt_id: notSent.id, kind: 'strong' })).status).toBe(404);
    expect((await sendCheer(db, one.token, { attempt_id: 'june-0-0', kind: 'strong' })).status).toBe(404);
    expect((await sendCheer(db, one.token, { attempt_id: hers.id, kind: 'strong', name: '123' })).status).toBe(400);
    await db.update(lifters).set({ deletedAt: NOW }).where(eq(lifters.id, one.l.id));
    expect((await sendCheer(db, one.token, { attempt_id: hers.id, kind: 'strong' })).status).toBe(404);
  });

  it('item 80: her cheers this meet, each person once, and a banner marks them seen', async () => {
    const { l, m, token } = await lifter();
    const [mate] = await db.insert(lifters).values({ cardName: 'Dee Rivers', division: 'barbell', meetId: m.id }).returning();
    const [f] = await db.insert(flights).values({ meetId: m.id, division: 'barbell', number: 1 }).returning();
    await db.update(lifters).set({ flightId: f.id }).where(eq(lifters.id, l.id));
    const a0 = await lift(l, 0, 'white'), a1 = await lift(l, 1, 'white');
    await sendCheer(db, token, { attempt_id: a0.id, kind: 'strong', name: 'Mom' });
    await sendCheer(db, token, { attempt_id: a0.id, kind: 'strong' });
    expect((await sendFlightCheer(db, { ...mate, flightId: f.id }, { attempt_id: a0.id, kind: 'white_lights' })).status).toBe(200);
    await sendCheer(db, token, { attempt_id: a1.id, kind: 'got_this', name: 'MOM' });
    const all = await herCheers(db, l.id, m.id);
    expect(all.map(c => `${c.name ?? '-'} ${c.kind}`)).toEqual(['Mom strong', '- strong', 'Dee white_lights', 'MOM got_this']);
    expect(all[0].who).toBe(all[3].who); // Mom, ignoring case
    expect(all[2].who).not.toContain(mate.id); // an opaque key, never a lifter's id
    expect(partsText(waitingParts(all))).toBe('Mom and Dee cheered you on.');
    expect(partsText(cornerBlock(all)!.line)).toBe('Mom and Dee cheered you on this weekend.');
    expect(cornerBlock(all)!.count).toBe('4 cheers');
    expect(await markSeen(db, l.id, [all[0].id, all[1].id])).toBe(2);
    expect(await markSeen(db, l.id, [all[0].id])).toBe(0); // already seen
    expect((await herCheers(db, l.id, m.id, true)).map(c => c.id)).toEqual([all[2].id, all[3].id]);
    // someone else can't mark hers
    expect(await markSeen(db, mate.id, [all[2].id])).toBe(0);
  });

  it('a flight cheer: only a flightmate\'s sent attempt, never her own, once; the demo flight keeps nothing', async () => {
    const { l, m } = await lifter();
    const [f] = await db.insert(flights).values({ meetId: m.id, division: 'barbell', number: 2 }).returning();
    const [g] = await db.insert(flights).values({ meetId: m.id, division: 'barbell', number: 3 }).returning();
    await db.update(lifters).set({ flightId: f.id }).where(eq(lifters.id, l.id));
    const [mate] = await db.insert(lifters).values({ cardName: 'Ada', division: 'barbell', meetId: m.id, flightId: f.id }).returning();
    const [other] = await db.insert(lifters).values({ cardName: 'Rhea', division: 'barbell', meetId: m.id, flightId: g.id }).returning();
    const a = await lift(l, 0, 'white');
    const notSent = await lift(l, 1, null, 'declared');
    const from = (x: typeof mate) => ({ id: x.id, cardName: x.cardName, flightId: x.flightId, isDemo: false });
    expect((await sendFlightCheer(db, from(other), { attempt_id: a.id, kind: 'strong' })).status).toBe(404);
    expect((await sendFlightCheer(db, { ...from(mate), id: l.id }, { attempt_id: a.id, kind: 'strong' })).status).toBe(404);
    expect((await sendFlightCheer(db, from(mate), { attempt_id: notSent.id, kind: 'strong' })).status).toBe(404);
    expect((await sendFlightCheer(db, from(mate), { attempt_id: a.id, kind: 'boo' })).status).toBe(400);
    expect((await sendFlightCheer(db, from(mate), { attempt_id: a.id, kind: 'strong' })).status).toBe(200);
    expect((await sendFlightCheer(db, from(mate), { attempt_id: a.id, kind: 'see_you' })).status).toBe(409);
    expect((await sendFlightCheer(db, from(mate), { attempt_id: 'flight-1-2', kind: 'strong' })).status).toBe(404);
    expect((await sendFlightCheer(db, { ...from(mate), isDemo: true }, { attempt_id: 'flight-1-2', kind: 'strong' })).status).toBe(200);
    expect((await db.select().from(cheers).where(eq(cheers.toLifterId, l.id))).map(c => c.fromLifterId)).toEqual([mate.id]);
  });
});
