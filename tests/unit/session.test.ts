// Plan 3.1: the session cookie, staging's test sign-in guards and the role checks.
import { describe, expect, test } from 'vitest';
import { decodeSession, encodeSession } from '../../web/lib/session';
import { PRODUCTION_SERVICE, testSigninOn, TEST_ACCOUNTS } from '../../web/lib/test-signin';
import { adminEmails, isAdminEmail } from '../../web/lib/roles';

describe('session cookie', () => {
  test('round-trips and lasts 90 days for a lifter, 7 for a demo lifter', () => {
    const now = 1_700_000_000_000;
    const a = encodeSession('L1', 'lifter', now, 'k');
    expect(a.maxAge).toBe(90 * 86400);
    expect(decodeSession(a.value, now, 'k')).toMatchObject({ lifterId: 'L1', kind: 'lifter' });
    expect(decodeSession(a.value, now + 91 * 86_400_000, 'k')).toBeNull();
    expect(encodeSession('D', 'demo', now, 'k').maxAge).toBe(7 * 86400);
  });
  test('a changed or wrongly signed cookie is refused', () => {
    const { value } = encodeSession('L1', 'lifter', Date.now(), 'k');
    const [p, s] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ lifterId: 'L2', kind: 'lifter', exp: Date.now() + 1e9 })).toString('base64url');
    expect(decodeSession(`${forged}.${s}`, Date.now(), 'k')).toBeNull();
    expect(decodeSession(`${p}.${s}`, Date.now(), 'other')).toBeNull();
    expect(decodeSession('junk', Date.now(), 'k')).toBeNull();
  });
});

describe('/signin/test guards', () => {
  test('a 404 with the setting on and production\'s service name', () => {
    expect(testSigninOn({ STAGING_TEST_SIGNIN: 'on', RENDER_SERVICE_NAME: PRODUCTION_SERVICE }, 'first-meet-staging.onrender.com')).toBe(false);
  });
  test('on for staging\'s service with the setting on, never without it', () => {
    expect(testSigninOn({ STAGING_TEST_SIGNIN: 'on', RENDER_SERVICE_NAME: 'first-meet-web-staging' })).toBe(true);
    expect(testSigninOn({ RENDER_SERVICE_NAME: 'first-meet-web-staging' })).toBe(false);
    expect(testSigninOn({ STAGING_TEST_SIGNIN: 'yes', RENDER_SERVICE_NAME: 'first-meet-web-staging' })).toBe(false);
  });
  test('with no service name, only staging\'s host or this computer', () => {
    const on = { STAGING_TEST_SIGNIN: 'on' };
    expect(testSigninOn(on, 'first-meet-web-staging.onrender.com')).toBe(true);
    expect(testSigninOn(on, 'localhost:3100')).toBe(true);
    expect(testSigninOn(on, 'first-meet-web.onrender.com')).toBe(false);
    expect(testSigninOn(on, null)).toBe(false);
  });
  test('the three accounts are .invalid, and only the referee has a role flag', () => {
    for (const a of Object.values(TEST_ACCOUNTS)) expect(a.email).toMatch(/@first-meet\.invalid$/);
    expect(TEST_ACCOUNTS.referee.isReferee).toBe(true);
    expect(TEST_ACCOUNTS.admin.isReferee).toBe(false);
    expect(TEST_ACCOUNTS.lifter).toMatchObject({ isReferee: false, next: '/referee' });
  });
});

describe('admin comes only from ADMIN_EMAILS', () => {
  const env = { ADMIN_EMAILS: ' Test-Admin@first-meet.invalid , ops@example.com' };
  test('case and spaces don\'t matter; anyone else isn\'t admin', () => {
    expect(adminEmails(env)).toEqual(['test-admin@first-meet.invalid', 'ops@example.com']);
    expect(isAdminEmail('test-admin@first-meet.invalid', env)).toBe(true);
    expect(isAdminEmail('test-lifter@first-meet.invalid', env)).toBe(false);
    expect(isAdminEmail(null, env)).toBe(false);
  });
});
