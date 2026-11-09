// The platform (5.24–5.28) on the server: the window's states, the openers declared for her, the
// 9-attempt row through all nine, and the judged frame her card's still shows.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { attempts, lifters, meets } from '../../web/db/schema';
import { startDemo } from '../../web/lib/demo';
import { declareNext, declareSheet } from '../../web/lib/meet-flow';
import { platformView } from '../../web/lib/platform-view';
import { judgedFrame } from '../../web/lib/attempt-state';
import type { Pt } from '../../web/lib/judge/pose';
import { freshDb, MemStore, URL_ } from './setup';

describe.skipIf(!URL_)('the platform', () => {
  let db: Db, drop: () => Promise<void>;
  const store = new MemStore();
  beforeAll(async () => { ({ db, drop } = await freshDb(4)); });
  afterAll(async () => drop?.());

  const meetOf = async (id: string) => (await db.select().from(meets).where(eq(meets.id, id)))[0];
  const lifterOf = async (id: string) => (await db.select().from(lifters).where(eq(lifters.id, id)))[0];

  it('a real meet: the countdown before it opens, closed after with nothing lifted', async () => {
    const opensAt = new Date('2027-02-26T14:00:00Z'), closesAt = new Date('2027-02-27T23:00:00Z');
    const [m] = await db.insert(meets).values({ slug: 'feb', name: 'February Meet', kind: 'real', status: 'open', opensAt, closesAt }).returning();
    const [l] = await db.insert(lifters).values({ cardName: 'June', division: 'barbell', meetId: m.id }).returning();
    expect(await platformView(db, l, m, new Date('2027-02-25T12:00:00Z'))).toEqual({ kind: 'before', opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString(), meetName: 'February Meet' });
    expect(await platformView(db, l, m, new Date('2027-02-28T12:00:00Z'))).toEqual({ kind: 'closed', meetName: 'February Meet' });
    // and nothing was declared for her while it was closed
    expect(await db.select().from(attempts).where(eq(attempts.lifterId, l.id))).toHaveLength(0);
  });

  it('open, with nothing on her card: her squat opener is declared for her', async () => {
    const [m] = await db.insert(meets).values({ slug: 'now', name: 'Now Meet', kind: 'real', status: 'open', opensAt: new Date(Date.now() - 3600_000), closesAt: new Date(Date.now() + 3600_000) }).returning();
    const [l] = await db.insert(lifters).values({ cardName: 'Ana', division: 'barbell', meetId: m.id }).returning();
    const v = await platformView(db, l, m);
    if (v.kind !== 'open') throw new Error(v.kind);
    expect(v.current).toMatchObject({ lift: 'squat', number: 1, status: 'declared' });
    expect(v.notJudged).toBe(true);
    expect(v.because).toBe('Lighter than your best logged triple. Not judged in training yet.');
    expect(v.row.map(c => c.state)).toEqual(['now', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty']);
  });

  it('demo: all nine, openers with no sheet, the row lit as she goes, then the total', async () => {
    const d = await startDemo(db, { division: 'barbell' });
    const meet = await meetOf(d.meet.id);
    const l = await lifterOf(d.lifter.id);
    let v = await platformView(db, l, meet);
    if (v.kind !== 'open') throw new Error(v.kind);
    expect(v.demo).toBe(true);
    expect(v.current).toMatchObject({ id: d.attempt.id, lift: 'squat', number: 1, status: 'declared' });
    expect(v.row[0].state).toBe('now');
    expect(v.because).toBeTruthy();

    const calls = ['white', 'red', 'white', 'white', 'white', 'red', 'white', 'white', 'white'] as const;
    for (let i = 0; i < 9; i++) {
      v = await platformView(db, l, meet);
      if (v.kind !== 'open') throw new Error(`${i}: ${v.kind}`);
      // the one she lifts now is the next slot, declared (an opener with no sheet)
      expect(v.current.status).toBe('declared');
      expect(v.row.filter(c => c.state === 'now')).toHaveLength(1);
      expect(v.row.slice(0, i).map(c => c.state)).toEqual(calls.slice(0, i));
      await db.update(attempts).set({ status: 'judged', call: calls[i], lights: calls[i] === 'white' ? ['white', 'white', 'white'] : ['red', 'red', 'white'] }).where(eq(attempts.id, v.current.id));
      if (i === 8) break;
      const sheet = await declareSheet(db, l);
      // the lift's last attempt: "Next: Bench press" declares the opener with no sheet (5.25 step 11)
      if (i % 3 === 2) { expect(sheet.kind).toBe('opener'); expect(await declareNext(db, l, null)).toMatchObject({ status: 200 }); continue; }
      if (sheet.kind !== 'sheet') throw new Error(`${i}: ${sheet.kind}`);
      // a red attempt: the next one stays as declared (5.27), so "the same weight" is on offer
      if (calls[i] === 'red') expect(sheet.last.red).toBe(true);
      const pick = sheet.choices.find(c => c.selected && !c.disabled) ?? sheet.choices.find(c => !c.disabled)!;
      expect(await declareNext(db, l, pick.value)).toMatchObject({ status: 200 });
    }
    const done = await platformView(db, l, meet);
    if (done.kind !== 'done') throw new Error(done.kind);
    expect(done.row.map(c => c.state)).toEqual([...calls]);
    expect(done.nine.map(a => a.call)).toEqual([...calls]);
    expect(done.nine[1].lights).toEqual(['red', 'red', 'white']);
  });

  it('a close call waits in the row; the next attempt can still be declared', async () => {
    const d = await startDemo(db, { division: 'home' });
    const meet = await meetOf(d.meet.id);
    const l = await lifterOf(d.lifter.id);
    await db.update(attempts).set({ status: 'close_call', call: 'close' }).where(eq(attempts.id, d.attempt.id));
    const v = await platformView(db, l, meet);
    if (v.kind !== 'open') throw new Error(v.kind);
    expect(v.row[0].state).toBe('waiting');
    expect(v.current.kind).not.toBeNull();
    expect((await declareSheet(db, l)).kind).toBe('sheet');
  });

  it('the judged frame: her own attempt only, the pose nearest the frame, the clip signed', async () => {
    const d = await startDemo(db, {});
    const other = await startDemo(db, {});
    expect(await judgedFrame(db, store, d.attempt.id, d.lifter.id)).toMatchObject({ status: 404 });
    const p = (x: number): Pt[] => Array.from({ length: 33 }, () => [x, 0.5, 0, 0.9] as Pt);
    await store.putJson('poses/a.json', { frames: [{ t: 2000, p: p(0.1) }, { t: 2400, p: null }, { t: 2500, p: p(0.3) }, { t: 3000, p: p(0.5) }] });
    await db.update(attempts).set({ status: 'judged', call: 'white', videoKey: 'meet/a.webm', posesKey: 'poses/a.json', judgedFrameMs: 2400, measures: { side: 'left' } }).where(eq(attempts.id, d.attempt.id));
    expect(await judgedFrame(db, store, d.attempt.id, other.lifter.id)).toMatchObject({ status: 403 });
    expect(await judgedFrame(db, store, 'nope', d.lifter.id)).toMatchObject({ status: 404 });
    const r = await judgedFrame(db, store, d.attempt.id, d.lifter.id);
    if (r.status !== 200) throw new Error(r.error);
    expect(r.frame).toMatchObject({ clip_url: 'https://r2.test/meet/a.webm?signed', ms: 2400, side: 'left' });
    expect(r.frame.p[0][0]).toBe(0.3);
  });
});
