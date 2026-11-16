// Her meet card on the server (plan 5.30, 5.5, item 99): her card and its clip by her card token, sharing
// the clip (this clip only, the first time), the certificate's nine, and the corner page's card.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, lifters, meets } from '../../web/db/schema';
import { ORDER } from '../../web/lib/meet';
import { cardFor, cardForToken, certificateFor, clipOnCardLink, ensureCardToken, shareCardClip } from '../../web/lib/card/card-data';
import { cornerView } from '../../web/lib/corner-view';
import { freshDb, URL_ } from './setup';

const NOW = new Date('2027-02-26T18:00:00Z');
const WEIGHTS = [95, 105, 115, 65, 70, 75, 135, 145, 155];

describe.skipIf(!URL_)('the meet card', () => {
  let db: Db, drop: () => Promise<void>;
  beforeAll(async () => { ({ db, drop } = await freshDb(5)); });
  afterAll(async () => drop?.());

  async function totaled(o: { clip?: 'judges' | 'flight' | 'link'; calls?: ('white' | 'red')[] } = {}) {
    const [m] = await db.insert(meets).values({
      slug: `m-${randomBytes(4).toString('hex')}`, name: 'Winter 2027', kind: 'real', status: 'open',
      opensAt: new Date('2027-02-26T11:00:00Z'), closesAt: new Date('2027-02-27T23:00:00Z'),
    }).returning();
    const [l] = await db.insert(lifters).values({
      cardName: 'Diane R.', division: 'barbell', meetId: m.id, cornerToken: randomBytes(12).toString('base64url'), clipVisibility: o.clip ?? 'judges',
    }).returning();
    const rows = [];
    for (let k = 0; k < 9; k++) {
      const call = o.calls?.[k] ?? 'white';
      const [a] = await db.insert(attempts).values({
        lifterId: l.id, meetId: m.id, lift: ORDER[k].lift, number: ORDER[k].number, weight: WEIGHTS[k], status: 'judged',
        call, lights: [call, call, call], videoKey: `videos/${k}.webm`,
      }).returning();
      rows.push(a);
    }
    return { l, m, rows };
  }

  it('her card\'s clip is her heaviest bar\'s attempt, and her card link finds it', async () => {
    const { l, rows } = await totaled();
    const card = await cardFor(db, l, NOW);
    expect(card?.view.total).toBe('345');
    expect(card?.clip).toEqual({ attemptId: rows[8].id, status: null, key: null, sharedAt: null });
    const token = await ensureCardToken(db, l);
    expect(await ensureCardToken(db, { id: l.id, cardToken: token })).toBe(token);
    expect((await cardForToken(db, token, NOW))?.lifter.id).toBe(l.id);
    expect(await cardForToken(db, 'not-a-token', NOW)).toBeNull();
  });

  it('sharing puts this clip, and only this clip, on her card link, once, and only when it\'s made', async () => {
    const { l, rows } = await totaled();
    const clipOf = async () => (await cardFor(db, (await db.select().from(lifters).where(eq(lifters.id, l.id)))[0], NOW))!.clip;
    // not made yet: nothing to share
    expect(await shareCardClip(db, l.id, rows[8].id)).toBe(false);
    await db.update(attempts).set({ clipStatus: 'ready', clipKey: `clips/${rows[8].id}.mp4` }).where(eq(attempts.id, rows[8].id));
    expect(clipOnCardLink('judges', await clipOf())).toBe(false);
    // someone else can't share her clip
    const other = await totaled();
    expect(await shareCardClip(db, other.l.id, rows[8].id)).toBe(false);
    expect(await shareCardClip(db, l.id, rows[8].id)).toBe(true);
    expect(await shareCardClip(db, l.id, rows[8].id)).toBe(false);
    expect(clipOnCardLink('judges', await clipOf())).toBe(true);
    // her other videos keep her setting
    const [r] = await db.select({ s: attempts.clipSharedAt }).from(attempts).where(eq(attempts.id, rows[0].id));
    expect(r.s).toBeNull();
    expect((await db.select({ v: lifters.clipVisibility }).from(lifters).where(eq(lifters.id, l.id)))[0].v).toBe('judges');
  });

  it('a deleted account\'s card goes with it (5.34)', async () => {
    const { l } = await totaled();
    const token = await ensureCardToken(db, l);
    await db.update(lifters).set({ deletedAt: new Date() }).where(eq(lifters.id, l.id));
    expect(await cardForToken(db, token, NOW)).toBeNull();
  });

  it('the certificate has all nine, in words', async () => {
    const { l } = await totaled({ calls: ['white', 'white', 'white', 'white', 'white', 'red', 'white', 'white', 'white'] });
    const card = await cardFor(db, l, NOW);
    const c = await certificateFor(db, card!);
    expect(c.total).toBe('340');
    expect(c.sheet[1]).toEqual({ lift: 'Bench press', cells: [{ weight: '65 lb', result: 'Good lift' }, { weight: '70 lb', result: 'Good lift' }, { weight: '75 lb', result: 'No lift' }] });
  });

  it('her corner page shows her story card once she totals (5.4)', async () => {
    const { l } = await totaled();
    const v = await cornerView(db, l.cornerToken!, NOW);
    const [row] = await db.select({ t: lifters.cardToken }).from(lifters).where(eq(lifters.id, l.id));
    expect(v).toMatchObject({ kind: 'totaled', card: `/api/card/${row.t}.png?f=story` });
  });
});
