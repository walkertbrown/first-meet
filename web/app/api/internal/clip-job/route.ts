// POST /api/internal/clip-job (plan 3.9 step 6, piece 7): a render_clip run asks for the next lift
// clip. 200 with the job, or 204 when no clip waits or an attempt is waiting for its poses.
import { db } from '@/db';
import { signedJson } from '@/lib/hmac';
import { claimClip } from '@/lib/card/clip-job';
import { r2 } from '@/lib/r2';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await signedJson<{ worker_id?: string }>(req);
  if (!body) return new Response(null, { status: 401 });
  if (typeof body.worker_id !== 'string' || !body.worker_id) return new Response(null, { status: 400 });
  const job = await claimClip(db(), r2(), body.worker_id);
  if (!job) return new Response(null, { status: 204 });
  console.log(JSON.stringify({ msg: 'clip claimed', attempt_id: job.attempt_id, worker_id: body.worker_id }));
  return Response.json(job);
}
