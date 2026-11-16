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
    expect(await lostBarVoid(db, a.id, d.lifter.id)).toEqual({ status: 200, body: { ok: true } });
    const [e] = await voids(a.id);
    expect(e.detail).toEqual({ lift: 'bench', why: 'no_start' });
    const [after] = await db.select().from(attempts).where(eq(attempts.id, a.id));
    expect(after).toMatchObject({ status: 'declared', call: null, voidReason: null });
    // a second void on the re-filmed attempt is counted too
    expect(await lostBarVoid(db, a.id, d.lifter.id)).toMatchObject({ status: 200 });
    expect(await voids(a.id)).toHaveLength(2);
  });
});
