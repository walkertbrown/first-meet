// POST /api/demo/again: phase 2 has only the first attempt, so "Lift it again" makes a fresh one.
import { db } from '@/db';
import { liftAgain } from '@/lib/demo';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const s = sessionFrom(req);
  if (!s || s.kind !== 'demo') return Response.json({ error: 'demo lifters only' }, { status: 401 });
  const a = await liftAgain(db(), s.lifterId);
  if (!a) return Response.json({ error: 'no demo lifter' }, { status: 404 });
  return Response.json({ attempt: { id: a.id, status: a.status } });
}
