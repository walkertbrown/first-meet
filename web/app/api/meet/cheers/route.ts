// Her cheers on meet weekend (plan 5.24, item 80).
//   GET  /api/meet/cheers -> { unseen: HerCheer[], corner: { line, count } | null }
//   POST /api/meet/cheers { ids } -> a banner showed these to her
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { lifters } from '@/db/schema';
import { cornerBlock, herCheers, markSeen } from '@/lib/cheers';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

async function her(req: Request) {
  const s = sessionFrom(req);
  if (!s) return null;
  const [l] = await db().select({ id: lifters.id, meetId: lifters.meetId, deletedAt: lifters.deletedAt }).from(lifters).where(eq(lifters.id, s.lifterId));
  return l && !l.deletedAt ? l : null;
}

export async function GET(req: Request) {
  const l = await her(req);
  if (!l) return Response.json({ error: 'sign in first' }, { status: 401 });
  if (!l.meetId) return Response.json({ unseen: [], corner: null }, { headers: { 'cache-control': 'no-store' } });
  const all = await herCheers(db(), l.id, l.meetId);
  const unseen = await herCheers(db(), l.id, l.meetId, true);
  return Response.json({ unseen, corner: cornerBlock(all) }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request) {
  const l = await her(req);
  if (!l) return Response.json({ error: 'sign in first' }, { status: 401 });
  const body = await req.json().catch(() => null) as { ids?: unknown } | null;
  if (!body || !Array.isArray(body.ids)) return Response.json({ error: 'ids, please' }, { status: 400 });
  return Response.json({ seen: await markSeen(db(), l.id, body.ids as string[]) });
}
