// POST /api/internal/clip (plan 3.9 step 6, piece 7): a render_clip run says how her clip went.
import { db } from '@/db';
import { signedJson } from '@/lib/hmac';
import { parseClipPost, takeClip } from '@/lib/card/clip-job';
import { r2 } from '@/lib/r2';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = await signedJson<unknown>(req);
  if (!raw) return new Response(null, { status: 401 });
  const p = parseClipPost(raw);
  if (!p) return new Response(null, { status: 400 });
  const r = await takeClip(db(), r2(), p);
  if (r.status !== 200) console.log(JSON.stringify({ msg: 'clip dropped', attempt_id: p.attempt_id, worker_id: p.worker_id, why: r.error }));
  return Response.json(r, { status: r.status });
}
