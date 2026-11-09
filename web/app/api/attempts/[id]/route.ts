// GET /api/attempts/:id: her own attempt's state while she waits for lights (plan 5.25 steps 8–9).
// ?wait=1 adds the estimate she sees after 90 s (3.9 step 8).
import { db } from '@/db';
import { attemptState } from '@/lib/attempt-state';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in' }, { status: 401 });
  const { id } = await params;
  const r = await attemptState(db(), id, s.lifterId, new URL(req.url).searchParams.get('wait') === '1');
  return 'attempt' in r ? Response.json(r.attempt, { headers: { 'cache-control': 'no-store' } }) : Response.json({ error: r.error }, { status: r.status });
}
