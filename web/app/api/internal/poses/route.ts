// POST /api/internal/poses (plan 3.9 step 5): a worker's points for one pass. Pass 1 is
// answered with where pass 2 looks; pass 2 is judged.
import { db } from '@/db';
import { signedJson } from '@/lib/hmac';
import { parsePoses, takePoses } from '@/lib/queue';
import { r2 } from '@/lib/r2';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = await signedJson<unknown>(req);
  if (!raw) return new Response(null, { status: 401 });
  const p = parsePoses(raw);
  if (!p) return new Response(null, { status: 400 });
  const r = await takePoses(db(), r2(), p);
  if (r.status !== 200) console.log(JSON.stringify({ msg: 'poses dropped', attempt_id: p.attempt_id, worker_id: p.worker_id, pass: p.pass, why: r.error }));
  return Response.json(r, { status: r.status });
}
