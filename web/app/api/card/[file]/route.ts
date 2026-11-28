// Her meet card's files (plan 5.30, 5.5, look 9), by the card token, the card link's only key:
//   GET /api/card/<token>.png?f=story|post  the card PNG, drawn by Satori off the server's thread. Public.
//   GET /api/card/<token>.mp4               render_clip's lift clip, with Range for Safari's video.
//     Public once it's on her card link (shared, or her videos are "Anyone with my card link"; item 99),
//     and always to her. Anyone else, or no clip yet: 404.
// `?download=1` makes either a file to save ("Save to my phone"). No total yet, or no such card: 404.
// `?clip=1&t=&s=`, signed by the clip job: a claimed clip's end card, drawn first; 503 + Retry-After until it is.
import { db, hasDb } from '@/db';
import { cardForToken, clipOnCardLink } from '@/lib/card/card-data';
import { fileStem } from '@/lib/card/card-view';
import { cardImage, clipCardImage } from '@/lib/card/card-png';
import { clipCardOk } from '@/lib/card/best-lift';
import type { CardFormat } from '@/lib/card/card-image';
import { hasR2, r2 } from '@/lib/r2';
import { currentViewer } from '@/lib/roles';
import { juneCardView } from '@/lib/corner-view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const none = () => Response.json({ error: 'no such card' }, { status: 404 });

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = file.match(/^(.+)\.(png|mp4)$/);
  const q = new URL(req.url).searchParams;
  const f = q.get('f') ?? 'story';
  const download = q.get('download') === '1';
  if (!m || (m[2] === 'png' && f !== 'story' && f !== 'post')) return none();
  // June's card on /corner/demo (5.36): no account, so no clip and no download name of her own
  if (m[1] === 'demo') {
    const v = m[2] === 'png' ? juneCardView() : null;
    if (!v) return none();
    const img = await cardImage(v, f as CardFormat);
    img.headers.set('Cache-Control', 'public, max-age=3600');
    return img;
  }
  if (!hasDb()) return Response.json({ error: 'no database' }, { status: 503 });
  const card = await cardForToken(db(), m[1]);
  if (!card) return none();
  const stem = `first-meet-${fileStem(card.lifter.cardName)}`;

  if (m[2] === 'png') {
    if (f === 'story' && q.get('clip') === '1' && clipCardOk(m[1], q.get('t'), q.get('s'), process.env.JUDGE_CALLBACK_SECRET)) {
      const img = await clipCardImage(card.view);
      img.headers.set('Cache-Control', 'no-store');
      return img;
    }
    const img = await cardImage(card.view, f as CardFormat);
    // a referee can still change a light until the board is final, so the card is cached only briefly
    img.headers.set('Cache-Control', 'public, max-age=60');
    if (download) img.headers.set('Content-Disposition', `attachment; filename="${stem}-${f}.png"`);
    return img;
  }

  const clip = card.clip;
  if (!clip?.key || clip.status !== 'ready' || !hasR2()) return none();
  if (!clipOnCardLink(card.lifter.clipVisibility, clip)) {
    const v = await currentViewer(db());
    if (v?.id !== card.lifter.id) return none();
  }
  const range = req.headers.get('range');
  const got = await r2().get(clip.key, range ? { range } : {});
  if (!got) return none();
  const h = new Headers({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=60' });
  for (const k of ['content-length', 'content-range', 'etag', 'last-modified']) { const x = got.headers.get(k); if (x) h.set(k, x); }
  if (download) h.set('Content-Disposition', `attachment; filename="${stem}-clip.mp4"`);
  return new Response(got.body, { status: got.status, headers: h });
}
