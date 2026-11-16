// POST /api/attempts/:id/upload-failed {error, before_start}: the phone showed "Your clip didn't
// send" (3.11). Logged as an `upload_failed` event, by device, for /ops (2.4).
import { db } from '@/db';
import { deviceFromHeaders } from '@/lib/device';
import { sessionFrom } from '@/lib/session';
import { uploadFailed } from '@/lib/uploads';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in' }, { status: 401 });
  const { id } = await params;
  const text = await req.text();
  if (text.length > 1000) return Response.json({ error: 'too long' }, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* below */ }
  if (!body || typeof body !== 'object') return Response.json({ error: 'bad body' }, { status: 400 });
  const { status, ...rest } = await uploadFailed(db(), id, s.lifterId, body as Record<string, unknown>, deviceFromHeaders(req.headers));
  return Response.json(rest, { status });
}
