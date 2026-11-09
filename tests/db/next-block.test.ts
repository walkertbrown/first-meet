// Item 76: the closed page's next block date (5.24) comes from the next real meet whose block hasn't
// started, so Walker's #spring-date answer is a change to a row.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { meets } from '../../web/db/schema';
import { ensureRealMeets, nextBlockStarts } from '../../web/lib/next-block';
import { freshDb, URL_ } from './setup';

describe.skipIf(!URL_)('the next block', () => {
  let db: Db, drop: () => Promise<void>;
  beforeAll(async () => { ({ db, drop } = await freshDb(2)); });
  afterAll(async () => drop?.());

  it('with no real meet ahead, "soon"', async () => {
    expect(await nextBlockStarts(db, new Date('2026-11-09T12:00:00Z'))).toBe('soon');
  });

  it('seeds Winter and Spring 2027 once, and gives an existing Winter row its block date without moving a set one', async () => {
    await db.insert(meets).values({ slug: 'winter-2027', name: 'Winter 2027', kind: 'real' });
    await ensureRealMeets(db);
    await ensureRealMeets(db);
    const rows = await db.select().from(meets);
    expect(rows.map(r => [r.slug, r.blockStartsOn]).sort()).toEqual([['spring-2027', '2027-03-01'], ['winter-2027', '2026-12-07']]);
    const spring = rows.find(r => r.slug === 'spring-2027')!;
    expect([spring.kind, spring.status, spring.opensAt?.toISOString(), spring.closesAt?.toISOString(), spring.liveAt?.toISOString()])
      .toEqual(['real', 'upcoming', '2027-05-21T10:00:00.000Z', '2027-05-22T22:00:00.000Z', '2027-05-23T00:00:00.000Z']);
    // Walker picks another date: the row changes, and a later seed leaves it
    await db.update(meets).set({ blockStartsOn: '2027-03-08' }).where(eq(meets.slug, 'spring-2027'));
    await ensureRealMeets(db);
    expect((await db.select().from(meets).where(eq(meets.slug, 'spring-2027')))[0].blockStartsOn).toBe('2027-03-08');
    await db.update(meets).set({ blockStartsOn: '2027-03-01' }).where(eq(meets.slug, 'spring-2027'));
  });

  it("reads the next block that hasn't started, Eastern: Winter's before Dec 7, Spring's after, then soon", async () => {
    expect(await nextBlockStarts(db, new Date('2026-11-09T12:00:00Z'))).toBe('Monday, December 7');
    expect(await nextBlockStarts(db, new Date('2026-12-07T04:00:00Z'))).toBe('Monday, December 7'); // 11 pm Dec 6 Eastern
    expect(await nextBlockStarts(db, new Date('2027-02-28T12:00:00Z'))).toBe('Monday, March 1');
    expect(await nextBlockStarts(db, new Date('2027-03-01T12:00:00Z'))).toBe('soon');
  });

  it('a demo or sample meet never gives the date', async () => {
    await db.insert(meets).values({ slug: 'x-demo', name: 'Demo', kind: 'demo', blockStartsOn: '2027-04-05' });
    expect(await nextBlockStarts(db, new Date('2027-03-02T12:00:00Z'))).toBe('soon');
  });
});
