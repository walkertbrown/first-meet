// GET /api/attempts/:id/frame: her own judged attempt's frame and marks (plan 5.25 step 10), for
// the stage after a reload and for the banner's attempt (5.27). With `?held=1`, the frame the held
// breath holds dimmed after a reload, before the call is in (5.25 step 8).
import { db } from '@/db';
import { heldFrame, judgedFrame } from '@/lib/attempt-state';
import { hasR2, r2 } from '@/lib/r2';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in' }, { status: 401 });
  if (!hasR2()) return Response.json({ error: 'no clip store' }, { status: 404 });
  const { id } = await params;
  if (new URL(req.url).searchParams.get('held') === '1') {
    const h = await heldFrame(db(), r2(), id, s.lifterId).catch(() => ({ status: 404 as const, error: 'clip not found' }));
    return 'frame' in h ? Response.json(h.frame, { headers: { 'cache-control': 'no-store' } }) : Response.json({ error: h.error }, { status: h.status });
  }
  const r = await judgedFrame(db(), r2(), id, s.lifterId).catch(() => ({ status: 404 as const, error: 'clip not found' }));
  return 'frame' in r ? Response.json(r.frame, { headers: { 'cache-control': 'no-store' } }) : Response.json({ error: r.error }, { status: r.status });
}
