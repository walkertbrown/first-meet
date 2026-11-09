// The demo referee (plan 5.36): a demo lifter decides their own close call. Demo only; no
// sign-in beyond the demo's own session.
//   POST {lights: [l, head, r], reason?, rep?} → {call, lights}
import { db, hasDb } from '@/db';
import { saveLights, type SaveInput } from '@/lib/referee';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: Ctx) {
  if (!hasDb()) return Response.json({ error: 'no database' }, { status: 503 });
  const s = sessionFrom(req);
  if (!s || s.kind !== 'demo') return Response.json({ error: 'demo only' }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: 'no such close call' }, { status: 404 });
  const body = await req.json().catch(() => null) as SaveInput | null;
  if (!body || typeof body !== 'object') return Response.json({ error: 'bad body' }, { status: 400 });
  const { status, ...rest } = await saveLights(db(), id, { kind: 'demo', lifterId: s.lifterId }, { lights: body.lights, reason: body.reason ?? null, rep: body.rep ?? null });
  return Response.json(rest, { status });
}
