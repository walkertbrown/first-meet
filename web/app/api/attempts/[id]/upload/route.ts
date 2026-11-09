// The phone's upload of a meet attempt (web/lib/uploads.ts):
//   POST {type}                → {key, upload_id}           start
//   POST {upload_id, parts:[]} → {urls: {part: url}}        sign parts
//   GET  ?upload_id=           → {parts: [{part, etag}]}    what R2 has, to resume
import { db } from '@/db';
import { deviceFromHeaders } from '@/lib/device';
import { r2 } from '@/lib/r2';
import { sessionFrom } from '@/lib/session';
import { partsDone, signParts, startAttemptUpload } from '@/lib/uploads';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };
const json = (r: { status: number } & Record<string, unknown>) => { const { status, ...rest } = r; return Response.json(rest, { status }); };

export async function POST(req: Request, { params }: Ctx) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null) as { type?: string; upload_id?: string; parts?: number[] } | null;
  if (!body) return Response.json({ error: 'bad body' }, { status: 400 });
  if (body.upload_id && Array.isArray(body.parts)) return json(await signParts(db(), r2(), id, s.lifterId, body.upload_id, body.parts));
  if (typeof body.type !== 'string') return Response.json({ error: 'type is needed' }, { status: 400 });
  const r = await startAttemptUpload(db(), r2(), id, s.lifterId, body.type, deviceFromHeaders(req.headers));
  return 'uploadId' in r ? Response.json({ key: r.key, upload_id: r.uploadId }) : json(r);
}

export async function GET(req: Request, { params }: Ctx) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in' }, { status: 401 });
  const { id } = await params;
  const uploadId = new URL(req.url).searchParams.get('upload_id') ?? '';
  return json(await partsDone(db(), r2(), id, s.lifterId, uploadId));
}
