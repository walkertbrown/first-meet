// "You totaled" on the server (5.28): bombing out sets her free next meet once (#bombout-free), and
// a demo lifter's bomb out sets nothing (item 77).
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

  it('a real lifter who bombs out gets her free next meet', async () => {
    const l = await bombed(false);
    expect((await totalFor(db, l)).kind).toBe('bombed');
    expect(await credit(l.id)).toBe(true);
  });

  it('a demo lifter who bombs out: nothing is set', async () => {
    const l = await bombed(true);
    expect((await totalFor(db, l)).kind).toBe('bombed');
    expect(await credit(l.id)).toBe(false);
  });
});
