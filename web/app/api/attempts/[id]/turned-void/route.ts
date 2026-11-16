// POST /api/attempts/:id/turned-void: "Your phone turned during the lift" (3.10). Nothing is judged; the
// server logs `turned_void` for /ops (2.4). 409 once the attempt is past declared.
import { db } from '@/db';
import { turnedVoid } from '@/lib/turned-void';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in' }, { status: 401 });
  const { id } = await params;
  const r = await turnedVoid(db(), id, s.lifterId);
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
}
