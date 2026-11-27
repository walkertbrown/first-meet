// Her best lift's files on the bomb-out page (plan 5.28, item 101), only to her:
//   GET /api/me/best-lift/clip.mp4    render_clip's clip, with Range for Safari's video; `?download=1` saves it
//   GET /api/me/best-lift/poster.jpg  the poster beside it (look 9): the first frame of the 2 s hold
// No clip yet, not hers, or she didn't bomb out: 404.
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters } from '@/db/schema';
import { bestLiftFor } from '@/lib/card/best-lift-data';
import { fileStem } from '@/lib/card/card-view';
import { hasR2, keys, r2 } from '@/lib/r2';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const none = () => Response.json({ error: 'no clip' }, { status: 404 });

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (file !== 'clip.mp4' && file !== 'poster.jpg') return none();
  if (!hasDb() || !hasR2()) return Response.json({ error: 'no storage' }, { status: 503 });
  const s = sessionFrom(req);
  if (!s) return none();
  const [l] = await db().select().from(lifters).where(eq(lifters.id, s.lifterId));
  if (!l || l.deletedAt) return none();
  const b = await bestLiftFor(db(), l);
  if (!b?.ready) return none();
  const poster = file === 'poster.jpg';
  const range = poster ? null : req.headers.get('range');
  const got = await r2().get(poster ? keys.clipPoster(b.attemptId) : keys.clip(b.attemptId), range ? { range } : {});
  if (!got) return none();
  const h = new Headers({ 'Content-Type': poster ? 'image/jpeg' : 'video/mp4', 'Cache-Control': 'private, max-age=60' });
  if (!poster) h.set('Accept-Ranges', 'bytes');
  for (const k of ['content-length', 'content-range', 'etag', 'last-modified']) { const x = got.headers.get(k); if (x) h.set(k, x); }
  if (!poster && new URL(req.url).searchParams.get('download') === '1') {
    h.set('Content-Disposition', `attachment; filename="first-meet-${fileStem(l.cardName)}-best-lift.mp4"`);
  }
  return new Response(got.body, { status: got.status, headers: h });
}
