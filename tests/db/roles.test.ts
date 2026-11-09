// Plan 3.1 on Postgres: staging's three test accounts, and the role checks they prove both ways.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../web/db';
import { lifters } from '../../web/db/schema';
import { testAccount } from '../../web/lib/test-signin';
import { viewerOf } from '../../web/lib/roles';
import { hasRole } from '../../web/lib/guard';
import { encodeSession, decodeSession } from '../../web/lib/session';
import { freshDb, URL_ } from './setup';

describe.skipIf(!URL_)('test accounts and roles', () => {
  let db: Db, drop: () => Promise<void>;
  const env = process.env.ADMIN_EMAILS;
  beforeAll(async () => { ({ db, drop } = await freshDb(4)); process.env.ADMIN_EMAILS = 'test-admin@first-meet.invalid'; });
  afterAll(async () => { process.env.ADMIN_EMAILS = env; await drop?.(); });

  const viewer = async (who: 'referee' | 'admin' | 'lifter') => {
    const { id, next } = await testAccount(db, who);
    const s = decodeSession(encodeSession(id, 'lifter').value);
    return { v: await viewerOf(db, s), next };
  };

  it('the test referee is a referee and nothing else, and goes to /referee', async () => {
    const { v, next } = await viewer('referee');
    expect(next).toBe('/referee');
    expect([hasRole(v, 'referee'), hasRole(v, 'admin'), hasRole(v, 'host')]).toEqual([true, false, false]);
  });

  it('the test admin is admin only through ADMIN_EMAILS, and goes to /ops', async () => {
    const { v, next } = await viewer('admin');
    expect(next).toBe('/ops');
    expect([hasRole(v, 'referee'), hasRole(v, 'admin')]).toEqual([false, true]);
    process.env.ADMIN_EMAILS = '';
    expect(hasRole(await viewerOf(db, v!.session), 'admin')).toBe(false);
    process.env.ADMIN_EMAILS = 'test-admin@first-meet.invalid';
  });

  it('a test lifter is turned away from /referee and /ops', async () => {
    const { v } = await viewer('lifter');
    expect(v).not.toBeNull();
    expect(hasRole(v, 'referee')).toBe(false);
    expect(hasRole(v, 'admin')).toBe(false);
  });

  it('signing in twice keeps one account per address', async () => {
    const a = await testAccount(db, 'referee');
    const b = await testAccount(db, 'referee');
    expect(a.id).toBe(b.id);
  });

  it('a demo lifter never has a role, even with the flag set', async () => {
    const [l] = await db.insert(lifters).values({ cardName: 'Demo lifter', isDemo: true, isReferee: true }).returning();
    const v = await viewerOf(db, { lifterId: l.id, kind: 'demo', exp: Date.now() + 1e6 });
    expect(hasRole(v, 'referee')).toBe(false);
  });

  it('no session, or a lifter that no longer exists, is nobody', async () => {
    expect(await viewerOf(db, null)).toBeNull();
    expect(await viewerOf(db, { lifterId: '00000000-0000-0000-0000-000000000000', kind: 'lifter', exp: Date.now() + 1e6 })).toBeNull();
  });
});
