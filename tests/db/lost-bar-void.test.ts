// The Barbell bench's void (plan 3.4b, item 74): no "Start!" out of the rack. Nothing is judged and the attempt
// stays declared, so "Film again" re-films it; the server logs `lost_bar_void` for /ops (2.4).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, events } from '../../web/db/schema';
import { startDemo } from '../../web/lib/demo';
import { lostBarVoid } from '../../web/lib/lost-bar-void';
import { freshDb, URL_ } from './setup';

describe.skipIf(!URL_)('the bench void', () => {
  let db: Db, drop: () => Promise<void>;
  beforeAll(async () => { ({ db, drop } = await freshDb(4)); });
  afterAll(async () => drop?.());

  async function bench(division: 'barbell' | 'home' = 'barbell', status: 'declared' | 'queued' = 'declared') {
    const d = await startDemo(db, { division });
    const [a] = await db.insert(attempts).values({
      lifterId: d.lifter.id, meetId: d.lifter.meetId!, lift: 'bench', number: 1, weight: 60, status,
      repsDeclared: division === 'home' ? 8 : null,
    }).returning();
    return { d, a };
  }
  const voids = (id: string) => db.select().from(events).where(and(eq(events.kind, 'lost_bar_void'), eq(events.attemptId, id)));

  it('404 for no such attempt, 403 for someone else\'s', async () => {
    const { d, a } = await bench();
    const other = await startDemo(db, {});
    expect(await lostBarVoid(db, 'nope', d.lifter.id)).toMatchObject({ status: 404 });
    expect(await lostBarVoid(db, '00000000-0000-0000-0000-000000000000', d.lifter.id)).toMatchObject({ status: 404 });
    expect(await lostBarVoid(db, a.id, other.lifter.id)).toMatchObject({ status: 403 });
    expect(await voids(a.id)).toHaveLength(0);
  });

  it('409 for a squat and for the Home overhead press: only the Barbell bench follows the bar', async () => {
    const sq = await startDemo(db, {});
    expect(await lostBarVoid(db, sq.attempt.id, sq.lifter.id)).toMatchObject({ status: 409 });
    const { d, a } = await bench('home');
    expect(await lostBarVoid(db, a.id, d.lifter.id)).toMatchObject({ status: 409, body: { error: 'not a Barbell bench' } });
  });

  it('409 once the attempt is on its way to the judges', async () => {
    const { d, a } = await bench('barbell', 'queued');
    expect(await lostBarVoid(db, a.id, d.lifter.id)).toMatchObject({ status: 409, body: { error: 'already filmed' } });
    expect(await voids(a.id)).toHaveLength(0);
  });

  it('200: logs the void, and the attempt stays declared to film again', async () => {
    const { d, a } = await bench();
    expect(await lostBarVoid(db, a.id, d.lifter.id)).toEqual({ status: 200, body: { ok: true, n: 1 } });
    const [e] = await voids(a.id);
    expect(e.detail).toEqual({ lift: 'bench', why: 'no_start', n: 1 });
    const [after] = await db.select().from(attempts).where(eq(attempts.id, a.id));
    expect(after).toMatchObject({ status: 'declared', call: null, voidReason: null });
    // a second void on the re-filmed attempt is counted too
    expect(await lostBarVoid(db, a.id, d.lifter.id)).toMatchObject({ status: 200 });
    expect(await voids(a.id)).toHaveLength(2);
  });

  it("item 112: the row keeps the phone's why (no_start_5s, stuck or low_score); anything else is the old no_start", async () => {
    const { d, a } = await bench();
    for (const why of ['no_start_5s', 'stuck', 'low_score', 'turned', 42, undefined]) await lostBarVoid(db, a.id, d.lifter.id, why);
    const rows = (await voids(a.id)).sort((x, y) => (x.detail as { n: number }).n - (y.detail as { n: number }).n);
    expect(rows.map(r => (r.detail as { why: string }).why)).toEqual(['no_start_5s', 'stuck', 'low_score', 'no_start', 'no_start', 'no_start']);
    expect(rows.map(r => (r.detail as { n: number }).n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('item 112: n counts the voids in a row since the last upload started; a turned void never resets it; each attempt on its own', async () => {
    const { d, a } = await bench();
    const n = async (id = a.id) => (await lostBarVoid(db, id, d.lifter.id)).body.n;
    expect(await n()).toBe(1);
    await db.insert(events).values({ kind: 'turned_void', attemptId: a.id, detail: { lift: 'bench' } });
    expect(await n()).toBe(2);
    expect(await n()).toBe(3);
    // filmed through to Rack!: the upload started (and failed, so the attempt is still declared to film again)
    await new Promise(r => setTimeout(r, 5));
    await db.insert(events).values({ kind: 'upload_started', attemptId: a.id, detail: { device: 'x' } });
    await new Promise(r => setTimeout(r, 5));
    expect(await n()).toBe(1);
    expect(await n()).toBe(2);
    expect((await voids(a.id)).map(e => (e.detail as { n: number }).n).sort()).toEqual([1, 1, 2, 2, 3]);
    // another attempt of hers starts at 1
    const [b] = await db.insert(attempts).values({ ...a, id: undefined, number: 2 } as never).returning();
    expect(await n(b.id)).toBe(1);
  });
});
