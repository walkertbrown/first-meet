// A phone that turned during the lift (plan 3.10): never judged, and the attempt stays declared so "Film
// again" re-films it; the server logs `turned_void` for /ops (2.4).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, events } from '../../web/db/schema';
import { startDemo } from '../../web/lib/demo';
import { turnedVoid } from '../../web/lib/turned-void';
import { freshDb, URL_ } from './setup';

describe.skipIf(!URL_)('the turned void', () => {
  let db: Db, drop: () => Promise<void>;
  beforeAll(async () => { ({ db, drop } = await freshDb(4)); });
  afterAll(async () => drop?.());
  const turned = (id: string) => db.select().from(events).where(and(eq(events.kind, 'turned_void'), eq(events.attemptId, id)));

  it('404 for no such attempt, 403 for someone else\'s', async () => {
    const d = await startDemo(db, {});
    const other = await startDemo(db, {});
    expect(await turnedVoid(db, 'nope', d.lifter.id)).toMatchObject({ status: 404 });
    expect(await turnedVoid(db, '00000000-0000-0000-0000-000000000000', d.lifter.id)).toMatchObject({ status: 404 });
    expect(await turnedVoid(db, d.attempt.id, other.lifter.id)).toMatchObject({ status: 403 });
    expect(await turned(d.attempt.id)).toHaveLength(0);
  });

  it('409 once the attempt is on its way to the judges', async () => {
    const d = await startDemo(db, {});
    await db.update(attempts).set({ status: 'queued' }).where(eq(attempts.id, d.attempt.id));
    expect(await turnedVoid(db, d.attempt.id, d.lifter.id)).toMatchObject({ status: 409, body: { error: 'already filmed' } });
  });

  it('200 for any lift: logs it, and the attempt stays declared to film again', async () => {
    const d = await startDemo(db, {});
    expect(await turnedVoid(db, d.attempt.id, d.lifter.id)).toEqual({ status: 200, body: { ok: true } });
    const [e] = await turned(d.attempt.id);
    expect(e.detail).toEqual({ lift: d.attempt.lift });
    const [after] = await db.select().from(attempts).where(eq(attempts.id, d.attempt.id));
    expect(after).toMatchObject({ status: 'declared', call: null, voidReason: null });
  });
});
