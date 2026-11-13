// POST /api/attempts/:id/bar-void: the bench's "We lost the bar" sheet (3.4b, item 74). Nothing is
// judged; the server logs `lost_bar_void` for /ops (2.4). 409 once the attempt is past declared.
import { db } from '@/db';
import { lostBarVoid } from '@/lib/lost-bar-void';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in' }, { status: 401 });
  const { id } = await params;
  const r = await lostBarVoid(db(), id, s.lifterId);
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
}
