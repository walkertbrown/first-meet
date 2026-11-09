// "You totaled" on the server (5.28): bombing out sets her free next meet once (#bombout-free), and
// with item 77 on a demo lifter's bomb out sets nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, lifters, meets } from '../../web/db/schema';
import { ORDER } from '../../web/lib/meet';
import { totalFor } from '../../web/lib/meet-flow';
import { freshDb, URL_ } from './setup';

describe.skipIf(!URL_)('the total', () => {
  let db: Db, drop: () => Promise<void>;
  beforeAll(async () => { ({ db, drop } = await freshDb(2)); });
  afterAll(async () => drop?.());

  /** A lifter whose three squats were red: bombed out. */
  async function bombed(isDemo: boolean) {
    const [m] = await db.insert(meets).values({ slug: `m-${Math.random()}`, name: 'Winter 2027', kind: isDemo ? 'demo' : 'real', status: 'open' }).returning();
    const [l] = await db.insert(lifters).values({ cardName: 'June', division: 'barbell', meetId: m.id, isDemo }).returning();
    for (const s of ORDER) {
      const red = s.lift === 'squat';
      await db.insert(attempts).values({ lifterId: l.id, meetId: m.id, lift: s.lift, number: s.number, weight: 100, status: 'judged', call: red ? 'red' : 'white', lights: red ? ['red', 'red', 'red'] : ['white', 'white', 'white'] });
    }
    return l;
  }
  const credit = async (id: string) => (await db.select().from(lifters).where(eq(lifters.id, id)))[0].freeEntryCredit;

  it('a real lifter who bombs out gets her free next meet, switched off or on', async () => {
    for (const item77 of [false, true]) {
      const l = await bombed(false);
      expect((await totalFor(db, l, undefined, item77)).kind).toBe('bombed');
      expect(await credit(l.id)).toBe(true);
    }
  });

  it('a demo lifter: set in the 1:12 AM copy, never with item 77 on', async () => {
    const off = await bombed(true);
    await totalFor(db, off, undefined, false);
    expect(await credit(off.id)).toBe(true);
    const on = await bombed(true);
    expect((await totalFor(db, on, undefined, true)).kind).toBe('bombed');
    expect(await credit(on.id)).toBe(false);
  });
});
