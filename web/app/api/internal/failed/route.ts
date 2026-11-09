// POST /api/internal/failed (plan 3.9, 3.11): a worker couldn't judge the attempt it holds.
// That attempt alone becomes a close call, judge_unavailable; the worker goes on to the next.
import { db } from '@/db';
import { signedJson } from '@/lib/hmac';
import { workerFailed } from '@/lib/queue';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await signedJson<{ attempt_id?: string; worker_id?: string; why?: string }>(req);
  if (!body) return new Response(null, { status: 401 });
  if (typeof body.attempt_id !== 'string' || typeof body.worker_id !== 'string') return new Response(null, { status: 400 });
  const why = typeof body.why === 'string' ? body.why : 'no reason given';
  const done = await workerFailed(db(), body.attempt_id, body.worker_id, why);
  console.log(JSON.stringify({ msg: 'worker failed', attempt_id: body.attempt_id, worker_id: body.worker_id, why: why.slice(0, 300), closed: done }));
  return new Response(null, { status: done ? 204 : 409 });
}
