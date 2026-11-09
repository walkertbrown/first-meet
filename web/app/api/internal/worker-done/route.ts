// POST /api/internal/worker-done (plan 2.3): a worker says it's ending.
import { db } from '@/db';
import { signedJson } from '@/lib/hmac';
import { workerDone } from '@/lib/queue';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await signedJson<{ worker_id?: string; commit?: string; attempts?: number }>(req);
  if (!body) return new Response(null, { status: 401 });
  if (typeof body.worker_id !== 'string') return new Response(null, { status: 400 });
  await workerDone(db(), body.worker_id, typeof body.commit === 'string' ? body.commit.slice(0, 12) : null);
  console.log(JSON.stringify({ msg: 'worker done', worker_id: body.worker_id, attempts: body.attempts ?? null, commit: body.commit ?? null }));
  return new Response(null, { status: 204 });
}
