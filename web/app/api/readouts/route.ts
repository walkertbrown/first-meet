// Her name on the host desk (plan 5.29).
//   GET  /api/readouts -> { readouts: PhoneReadout[] }: the last minute's, for the banner and the sheet
//   POST /api/readouts { ids } -> her phone showed these, so their emails don't go
import { db } from '@/db';
import { readoutsSeen, recentReadouts } from '@/lib/host-data';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in first' }, { status: 401 });
  return Response.json({ readouts: await recentReadouts(db(), s.lifterId) }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in first' }, { status: 401 });
  const body = await req.json().catch(() => null) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50) : null;
  if (!ids) return Response.json({ error: 'ids, please' }, { status: 400 });
  return Response.json({ seen: await readoutsSeen(db(), s.lifterId, ids) });
}
