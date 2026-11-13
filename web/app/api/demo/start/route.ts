// POST /api/demo/start (the /demo form, plan 5.36): a demo lifter and their first attempt, the
// 7-day demo session cookie, then the platform with the welcome sheet first.
import { db, hasDb } from '@/db';
import { startDemo } from '@/lib/demo';
import { cookieHeader, encodeSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!hasDb()) return new Response('First Meet is having a moment', { status: 503 });
  const form = await req.formData().catch(() => null);
  const { lifter } = await startDemo(db(), { cardName: form?.get('card_name'), division: form?.get('division') });
  const s = encodeSession(lifter.id, 'demo');
  return new Response(null, { status: 303, headers: { location: '/platform?welcome=1', 'set-cookie': cookieHeader(s.value, s.maxAge) } });
}

export const GET = () => new Response(null, { status: 303, headers: { location: '/demo' } });
