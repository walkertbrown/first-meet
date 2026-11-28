// Staging's "Referee bot test answers" (plan 3.4d step 7): the choice for the next job, from /ops.
// Admins only; anywhere but staging, a 404 (production never has it).
import { db, hasDb } from '@/db';
import { hasRole } from '@/lib/guard';
import { setSetting, testAnswersAllowed, TEST_ANSWERS_KEY } from '@/lib/referee/bot';
import { TEST_ANSWERS } from '@/lib/referee/lamps';
import { viewerOf } from '@/lib/roles';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!testAnswersAllowed(process.env) || !hasDb()) return new Response('Not found', { status: 404 });
  const v = await viewerOf(db(), sessionFrom(req));
  if (!hasRole(v, 'admin')) return new Response('Admins only', { status: 403 });
  const form = await req.formData().catch(() => null);
  const choice = String(form?.get('answers') ?? '');
  if (choice !== 'real' && !(TEST_ANSWERS as readonly string[]).includes(choice)) return new Response('Unknown test answer', { status: 400 });
  await setSetting(db(), TEST_ANSWERS_KEY, choice === 'real' ? null : choice);
  return new Response(null, { status: 303, headers: { location: '/ops' } });
}

export const GET = () => new Response('Not found', { status: 404 });
