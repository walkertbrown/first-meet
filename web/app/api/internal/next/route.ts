// POST /api/internal/next (plan 3.9 step 3): a worker asks for the oldest waiting attempt.
// 200 with the job, or 204 when nothing waits.
import { db } from '@/db';
import { signedJson } from '@/lib/hmac';
import { claimNext } from '@/lib/queue';
import { r2 } from '@/lib/r2';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await signedJson<{ worker_id?: string }>(req);
  if (!body) return new Response(null, { status: 401 });
  if (typeof body.worker_id !== 'string' || !body.worker_id) return new Response(null, { status: 400 });
  const job = await claimNext(db(), r2(), body.worker_id);
  if (!job) return new Response(null, { status: 204 });
  console.log(JSON.stringify({ msg: 'claimed', attempt_id: job.attempt_id, worker_id: body.worker_id }));
  return Response.json(job);
}
