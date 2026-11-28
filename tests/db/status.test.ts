// /status's numbers from the database (plan 5.7).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Db } from '../../web/db';
import { platformStatus } from '../../web/lib/status';
import { setStatusMessage } from '../../web/lib/meet-control';
import { freshDb, URL_ } from './setup';

describe.skipIf(!URL_)('platformStatus', () => {
  let db: Db, drop: () => Promise<void>;
  beforeAll(async () => { ({ db, drop } = await freshDb(3)); });
  afterAll(async () => drop?.());

  it('three rows; recording turns to trouble past 5% failed, with at least 3', async () => {
    let s = await platformStatus(db);
    expect(s.rows.map(r => r.label)).toEqual(['Lifting and recording', 'Judging', 'Referee bot']);
    expect(s.rows[0]).toMatchObject({ value: 'Normal', ok: true });
    await db.execute(sql`insert into events (kind, detail) select 'upload_started', '{}'::jsonb from generate_series(1, 20)`);
    await db.execute(sql`insert into events (kind, detail) select 'upload_failed', '{}'::jsonb from generate_series(1, 2)`);
    s = await platformStatus(db);
    expect(s.rows[0].value).toBe('Normal');
    await db.execute(sql`insert into events (kind, detail) values ('upload_refused', '{}'::jsonb)`);
    s = await platformStatus(db);
    expect(s.rows[0]).toMatchObject({ value: 'Having trouble', ok: false });
    expect(s.rows[2].value).toMatch(/^\d[\d,]* waiting · about \d+ minutes?$/);
  });

  it('a failing R2 check reads trouble; with the database down only that row shows', async () => {
    await db.execute(sql`delete from events`);
    expect((await platformStatus(db, { db: true, r2: false })).rows[0]).toMatchObject({ value: 'Having trouble', ok: false });
    expect((await platformStatus(db, { db: true, r2: true })).rows[0].value).toBe('Normal');
    expect((await platformStatus(db, { db: false, r2: true })).rows).toEqual([{ label: 'Lifting and recording', value: 'Having trouble', ok: false }]);
  });

  it('the incident card is the status message', async () => {
    await setStatusMessage(db, 'Judging is slow', 'Your lifts are saved.');
    expect((await platformStatus(db)).incident).toEqual({ title: 'Judging is slow', sentence: 'Your lifts are saved.' });
    await setStatusMessage(db, '', '');
    expect((await platformStatus(db)).incident).toBeNull();
  });
});
