// POST /api/internal/bar (plan 3.4b): a worker's plate path for a Barbell bench. Saved for the
// referee's marks, measured, and sent to a referee (reason bench_referee).
import { db } from '@/db';
import { signedJson } from '@/lib/hmac';
import { parseBar, takeBar } from '@/lib/queue';
import { r2 } from '@/lib/r2';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = await signedJson<unknown>(req);
  if (!raw) return new Response(null, { status: 401 });
  const p = parseBar(raw);
  if (!p) return new Response(null, { status: 400 });
  const r = await takeBar(db(), r2(), p);
  if (r.status !== 200) console.log(JSON.stringify({ msg: 'bar dropped', attempt_id: p.attempt_id, worker_id: p.worker_id, why: r.error }));
  return Response.json(r, { status: r.status });
}
