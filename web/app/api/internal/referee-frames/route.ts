// POST /api/internal/referee-frames (plan 3.4d step 1): `referee_frames` says its frames are in R2
// (the job is `ready`), or why there are none (one more try after 5 minutes, then `no_frames`).
import { db } from '@/db';
import { signedJson } from '@/lib/hmac';
import { takeFrames, type FramesPost } from '@/lib/referee/bot';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await signedJson<FramesPost>(req);
  if (!body) return new Response(null, { status: 401 });
  if (typeof body.job_id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.job_id) || typeof body.ok !== 'boolean') return new Response(null, { status: 400 });
  if (body.ok && !Array.isArray(body.frames)) return new Response(null, { status: 400 });
  const r = await takeFrames(db(), body);
  return Response.json(r, { status: r.status });
}
