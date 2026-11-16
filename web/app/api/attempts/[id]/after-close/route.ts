// POST /api/attempts/:id/after-close: she tapped "I'm ready" after the platform closed (3.8, 3.11,
// item 85). The server decides by its own clock: 200, `void` (`after_close`); 409, still open.
import { db } from '@/db';
import { startAfterClose } from '@/lib/meet-window';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in' }, { status: 401 });
  const { id } = await params;
  const r = await startAfterClose(db(), id, s.lifterId);
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
}
