// POST /api/corner/<token>/cheer {attempt_id, kind, name?}: a cheer from her corner page (plan 5.4).
// Public: the token is the page's only key. One cheer per sender per attempt.
import { db, hasDb } from '@/db';
import { sendCheer } from '@/lib/cheers';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return Response.json({ error: 'json, please' }, { status: 400 }); }
  if (token !== 'demo' && !hasDb()) return Response.json({ error: 'no database' }, { status: 503 });
  const r = await sendCheer(token === 'demo' ? (null as never) : db(), token, body);
  return r.status === 200 ? Response.json({ kind: r.kind }) : Response.json({ error: r.error }, { status: r.status });
}
