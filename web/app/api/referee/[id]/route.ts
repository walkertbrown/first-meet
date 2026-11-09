// A referee's close call (plan 5.33):
//   POST {action: 'save', lights: [l, head, r], reasons?: [l, head, r], rep?, note?}  → {call, lights, next}
//   POST {action: 'ask', note?}                                         → {next}  ("Ask another referee")
// Only a referee (3.1); a lifter without the role gets a 403.
import { db, hasDb } from '@/db';
import { hasRole } from '@/lib/guard';
import { askAnother, nextCloseCall, saveLights, type SaveInput } from '@/lib/referee';
import { viewerOf } from '@/lib/roles';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };
type Body = SaveInput & { action?: 'save' | 'ask' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: Ctx) {
  if (!hasDb()) return Response.json({ error: 'no database' }, { status: 503 });
  const v = await viewerOf(db(), sessionFrom(req));
  if (!hasRole(v, 'referee')) return Response.json({ error: 'referees only' }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: 'no such close call' }, { status: 404 });
  const body = await req.json().catch(() => null) as Body | null;
  if (!body || typeof body !== 'object') return Response.json({ error: 'bad body' }, { status: 400 });
  const note = typeof body.note === 'string' ? body.note : null;
  const r = body.action === 'ask'
    ? await askAnother(db(), id, v!.id, note)
    : await saveLights(db(), id, { kind: 'referee', id: v!.id }, { lights: body.lights, reasons: Array.isArray(body.reasons) ? body.reasons : null, reason: body.reason ?? null, rep: body.rep ?? null, note });
  const { status, ...rest } = r;
  if (status !== 200) return Response.json(rest, { status });
  const next = await nextCloseCall(db(), v!.id);
  return Response.json({ ...rest, next });
}
