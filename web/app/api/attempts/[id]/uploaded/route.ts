// POST /api/attempts/:id/uploaded {upload_id, parts, command_times, bar_path, bar_cadence, bar_frames} (plan 3.9 step 1, 3.4b).
import { db } from '@/db';
import { r2 } from '@/lib/r2';
import { sessionFrom } from '@/lib/session';
import { deviceFromHeaders } from '@/lib/device';
import { attemptUploaded } from '@/lib/uploads';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return Response.json({ error: 'bad body' }, { status: 400 });
  const { status, ...rest } = await attemptUploaded(db(), r2(), id, s.lifterId, body, new Date(), deviceFromHeaders(req.headers));
  return Response.json(rest, { status });
}
