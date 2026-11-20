// POST /api/internal/referee-frames-job (plan 3.4d step 1): a `referee_frames` run asks what to make
// for its job: the clip, the commands, the moments, and where to PUT each frame. 204 when the job
// isn't waiting for frames any more.
import { db } from '@/db';
import { signedJson } from '@/lib/hmac';
import { r2 } from '@/lib/r2';
import { framesJob } from '@/lib/referee/bot';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await signedJson<{ job_id?: string }>(req);
  if (!body) return new Response(null, { status: 401 });
  if (typeof body.job_id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.job_id)) return new Response(null, { status: 400 });
  const job = await framesJob(db(), r2(), body.job_id);
  if (!job) return new Response(null, { status: 204 });
  return Response.json(job);
}
