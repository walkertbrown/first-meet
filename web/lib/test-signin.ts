// Staging's test accounts (plan 3.1): /signin/test exists only when STAGING_TEST_SIGNIN is "on"
// AND the service isn't production's (RENDER_SERVICE_NAME). Otherwise a 404, so the setting
// copied to production by mistake still can't open it.
import type { Db } from '@/db';
import { lifters } from '@/db/schema';

export const PRODUCTION_SERVICE = 'first-meet-web';

export function testSigninOn(env: Record<string, string | undefined> = process.env, host?: string | null) {
  if (env.STAGING_TEST_SIGNIN !== 'on') return false;
  const service = env.RENDER_SERVICE_NAME;
  if (service) return service !== PRODUCTION_SERVICE;
  // No service name: go by the request's host, which must be staging's or this computer.
  const h = (host ?? '').toLowerCase().split(':')[0];
  return h.includes('staging') || h === 'localhost' || h === '127.0.0.1';
}

export const TEST_ACCOUNTS = {
  referee: { email: 'test-referee@first-meet.invalid', cardName: 'Test referee', isReferee: true, next: '/referee' },
  admin: { email: 'test-admin@first-meet.invalid', cardName: 'Test admin', isReferee: false, next: '/ops' },
  lifter: { email: 'test-lifter@first-meet.invalid', cardName: 'Test lifter', isReferee: false, next: '/referee' },
} as const;
export type TestWho = keyof typeof TEST_ACCOUNTS;

/** Makes the account if it doesn't exist (keeping its role as the plan has it), and returns its id. */
export async function testAccount(db: Db, who: TestWho): Promise<{ id: string; next: string }> {
  const a = TEST_ACCOUNTS[who];
  const [row] = await db.insert(lifters).values({ email: a.email, cardName: a.cardName, isReferee: a.isReferee })
    .onConflictDoUpdate({ target: lifters.email, set: { isReferee: a.isReferee, deletedAt: null } })
    .returning({ id: lifters.id });
  return { id: row.id, next: a.next };
}

