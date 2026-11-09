// Staging's test sign-in (plan 3.1): makes the account if it doesn't exist, gives it the normal
// 90-day session cookie, then goes to its page. Anywhere but staging, a 404. No mail is sent:
// .invalid addresses never get mail.
import { db, hasDb } from '@/db';
import { cookieHeader, encodeSession } from '@/lib/session';
import { MEET_WEEK_ACCOUNTS, TEST_ACCOUNTS, WINDOW_BUTTONS, meetWeekAccount, setTestHourNow, testAccount, testMeetWindow, testSigninOn, type MeetWeekWho, type TestWho, type WindowButton } from '@/lib/test-signin';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!testSigninOn(process.env, req.headers.get('host')) || !hasDb()) return new Response('Not found', { status: 404 });
  const form = await req.formData().catch(() => null);
  const who = String(form?.get('who') ?? '');
  // item 82: the test meet's hour, decided on the next read
  if (who === 'hour-now') {
    await setTestHourNow(db());
    return new Response(null, { status: 303, headers: { location: '/meet-week' } });
  }
  // item 86: the test meet's window by hand; each goes to the platform
  if (who in WINDOW_BUTTONS) {
    if (!await testMeetWindow(db(), who as WindowButton)) return new Response('No test meet yet', { status: 409 });
    return new Response(null, { status: 303, headers: { location: '/platform' } });
  }
  if (!(who in TEST_ACCOUNTS) && !(who in MEET_WEEK_ACCOUNTS)) return new Response('Unknown test account', { status: 400 });
  const { id, next } = who in MEET_WEEK_ACCOUNTS ? await meetWeekAccount(db(), who as MeetWeekWho) : await testAccount(db(), who as TestWho);
  const s = encodeSession(id, 'lifter');
  return new Response(null, { status: 303, headers: { location: next, 'set-cookie': cookieHeader(s.value, s.maxAge) } });
}

export const GET = () => new Response('Not found', { status: 404 });
