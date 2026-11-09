// The meet window's refusals on the server (3.8, 3.11, item 85): a lift recorded at or after the
// close, an upload past the clip deadline, "I'm ready" after the close, and the deadline's job.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, lifters, meets } from '../../web/db/schema';
import { runClipDeadline, startAfterClose } from '../../web/lib/meet-window';
import { signParts, startAttemptUpload } from '../../web/lib/uploads';
import { totalFor } from '../../web/lib/meet-flow';
import { ORDER } from '../../web/lib/meet';
import { platformView } from '../../web/lib/platform-view';
import { cornerView } from '../../web/lib/corner-view';
import { freshDb, MemStore, URL_ } from './setup';

const H = 3_600_000;

describe.skipIf(!URL_)('the meet window', () => {
  let db: Db, drop: () => Promise<void>;
  const store = new MemStore();
  beforeAll(async () => { ({ db, drop } = await freshDb(3)); });
  afterAll(async () => drop?.());

  /** A real meet that closed `hoursAgo` hours ago, and a lifter with one attempt in `status`. */
  async function setup(hoursAgo: number, status: 'declared' | 'recording' | 'uploading' = 'declared') {
    const closesAt = new Date(Date.now() - hoursAgo * H);
    const [m] = await db.insert(meets).values({ slug: `m-${Math.random()}`, name: 'Winter 2027', kind: 'real', status: 'open', opensAt: new Date(closesAt.getTime() - 48 * H), closesAt }).returning();
    const [l] = await db.insert(lifters).values({ cardName: 'June', division: 'barbell', meetId: m.id }).returning();
    const [a] = await db.insert(attempts).values({ lifterId: l.id, meetId: m.id, lift: 'squat', number: 1, weight: 100, status, createdAt: new Date(closesAt.getTime() - 2 * H) }).returning();
    return { m, l, a, closesAt };
  }
  const row = async (id: string) => (await db.select().from(attempts).where(eq(attempts.id, id)))[0];

  it('a lift recorded before the close uploads after it, within the deadline', async () => {
    const { l, a, closesAt } = await setup(1);
    const r = await startAttemptUpload(db, store, a.id, l.id, 'video/webm', 'test', new Date(closesAt.getTime() - 60_000).toISOString());
    expect(r.status).toBe(200);
    expect((await row(a.id)).status).toBe('uploading');
  });

  it('a lift recorded at or after the close: 410, void after_close, with both times; asked again, the same', async () => {
    const { m, l, a, closesAt } = await setup(1);
    const r = await startAttemptUpload(db, store, a.id, l.id, 'video/webm', 'test', closesAt.toISOString());
    expect(r).toMatchObject({ status: 410, void_reason: 'after_close', closes_at: closesAt.toISOString(), clip_deadline_at: new Date(closesAt.getTime() + 6 * H).toISOString() });
    expect(await row(a.id)).toMatchObject({ status: 'void', voidReason: 'after_close' });
    expect(await startAttemptUpload(db, store, a.id, l.id, 'video/webm')).toMatchObject({ status: 410, void_reason: 'after_close' });
    void m;
  });

  it('an upload step past the deadline: 410, void upload_late', async () => {
    const { l, a, closesAt } = await setup(7, 'uploading');
    await db.update(attempts).set({ recordedAt: new Date(closesAt.getTime() - 60_000), videoKey: 'k' }).where(eq(attempts.id, a.id));
    expect(await signParts(db, store, a.id, l.id, 'u', [1])).toMatchObject({ status: 410, void_reason: 'upload_late' });
    expect(await row(a.id)).toMatchObject({ status: 'void', voidReason: 'upload_late' });
  });

  it('"I\'m ready" after the close: void after_close by the server\'s clock; still open: 409, untouched', async () => {
    const closed = await setup(0.5);
    expect(await startAfterClose(db, closed.a.id, closed.l.id)).toMatchObject({ status: 200, body: { void_reason: 'after_close' } });
    expect(await row(closed.a.id)).toMatchObject({ status: 'void', voidReason: 'after_close' });
    const open = await setup(-1);
    expect((await startAfterClose(db, open.a.id, open.l.id)).status).toBe(409);
    expect((await row(open.a.id)).status).toBe('declared');
    expect((await startAfterClose(db, open.a.id, closed.l.id)).status).toBe(403);
  });

  it('the deadline\'s job voids uploads that never finished, never a slot only declared', async () => {
    const late = await setup(7, 'uploading');
    const declared = await setup(7, 'declared');
    const early = await setup(5, 'uploading');
    expect(await runClipDeadline(db, new Date(), late.m.id)).toBe(1);
    expect(await row(late.a.id)).toMatchObject({ status: 'void', voidReason: 'upload_late' });
    await runClipDeadline(db);
    expect((await row(declared.a.id)).status).toBe('declared');
    expect((await row(early.a.id)).status).toBe('uploading');
  });

  it('after the close her total uses the judged lifts; a late upload past the deadline settles it', async () => {
    const closesAt = new Date(Date.now() - 7 * H);
    const [m] = await db.insert(meets).values({ slug: `m-${Math.random()}`, name: 'Winter 2027', kind: 'real', status: 'open', opensAt: new Date(closesAt.getTime() - 48 * H), closesAt }).returning();
    const [l] = await db.insert(lifters).values({ cardName: 'Dee', division: 'barbell', meetId: m.id }).returning();
    for (const s of ORDER) {
      const last = s.number === 3 && s.lift === 'deadlift';
      await db.insert(attempts).values({ lifterId: l.id, meetId: m.id, lift: s.lift, number: s.number, weight: 100 + s.number, status: last ? 'uploading' : 'judged', call: last ? null : 'white' });
    }
    const t = await totalFor(db, l);
    expect(t).toMatchObject({ kind: 'total', value: 103 + 103 + 102 });
  });

  it('her platform after the close: nothing lifted, or only refused at the close, is the closed page', async () => {
    const none = await setup(1);
    expect(await platformView(db, none.l, none.m)).toEqual({ kind: 'closed', meetName: 'Winter 2027' });
    await startAfterClose(db, none.a.id, none.l.id);
    expect(await platformView(db, none.l, none.m)).toEqual({ kind: 'closed', meetName: 'Winter 2027' });
  });

  it('her total after the close with nothing lifted: no total, no bomb out, no free entry (NerdCider on 20d916a)', async () => {
    const none = await setup(1);
    expect(await totalFor(db, none.l)).toEqual({ kind: 'none' });
    await startAfterClose(db, none.a.id, none.l.id);
    expect(await totalFor(db, none.l)).toEqual({ kind: 'none' });
    expect((await db.select().from(lifters).where(eq(lifters.id, none.l.id)))[0].freeEntryCredit).toBe(false);
  });

  it('her platform after the close: her lifts, a void slot not judged, a declared slot empty; the deadline settles a clip that never came', async () => {
    const closesAt = new Date(Date.now() - 7 * H);
    const [m] = await db.insert(meets).values({ slug: `m-${Math.random()}`, name: 'Winter 2027', kind: 'real', status: 'open', opensAt: new Date(closesAt.getTime() - 48 * H), closesAt }).returning();
    const [l] = await db.insert(lifters).values({ cardName: 'Ana', division: 'barbell', meetId: m.id, cornerToken: `c-${Math.random().toString(36).slice(2)}` }).returning();
    await db.insert(attempts).values([
      { lifterId: l.id, meetId: m.id, lift: 'squat', number: 1, weight: 100, status: 'judged', call: 'white', lights: ['white', 'white', 'white'] },
      { lifterId: l.id, meetId: m.id, lift: 'squat', number: 2, weight: 105, status: 'void', voidReason: 'after_close' },
      { lifterId: l.id, meetId: m.id, lift: 'squat', number: 3, weight: 110, status: 'uploading' },
      { lifterId: l.id, meetId: m.id, lift: 'bench', number: 1, weight: 60, status: 'declared' },
    ]);
    const v = await platformView(db, l, m);
    if (v.kind !== 'done') throw new Error(v.kind);
    expect(v.row.slice(0, 4).map(c => c.state)).toEqual(['white', 'void', 'void', 'empty']);
    expect(v.row.slice(1, 3).map(c => c.voidReason)).toEqual(['after_close', 'upload_late']);
    expect(v.nine.map(a => [a.lift, a.number, a.voidReason ?? null])).toEqual([['squat', 1, null], ['squat', 2, 'after_close'], ['squat', 3, 'upload_late']]);
    // the corner page: the not-judged rows, newest first; no Cheer is the page's (corner.tsx)
    const c = await cornerView(db, l.cornerToken!);
    if (!c || !('list' in c)) throw new Error(`no corner: ${JSON.stringify(c)}`);
    expect(c.list.map(r => [r.number, r.state, r.voidReason ?? null])).toEqual([[3, 'void', 'upload_late'], [2, 'void', 'after_close'], [1, 'white', null]]);
    expect(c.row[3].state).toBe('empty');
  });

  it('her platform after the close, before the deadline: a clip still sending is listed as on its way', async () => {
    const { l, m } = await setup(1, 'uploading');
    const v = await platformView(db, l, m);
    if (v.kind !== 'done') throw new Error(v.kind);
    expect(v.nine).toMatchObject([{ held: true, voidReason: null }]);
    expect(v.row[0].state).toBe('sent');
  });
});
