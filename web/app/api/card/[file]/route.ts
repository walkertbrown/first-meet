// GET /api/card/<token>.png?f=story|post: her meet card as a PNG, drawn by Satori (plan 5.30, look 9).
// Public: the card token is the card link's only key (5.5). No total yet, or no such card: 404.
import { ImageResponse } from 'next/og';
import { db, hasDb } from '@/db';
import { cardForToken } from '@/lib/card/card-data';
import { cardImage } from '@/lib/card/card-png';
import type { CardFormat } from '@/lib/card/card-image';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = file.match(/^(.+)\.png$/);
  const f = new URL(req.url).searchParams.get('f') ?? 'story';
  if (!m || (f !== 'story' && f !== 'post')) return Response.json({ error: 'no such card' }, { status: 404 });
  if (!hasDb()) return Response.json({ error: 'no database' }, { status: 503 });
  const card = await cardForToken(db(), m[1]);
  if (!card) return Response.json({ error: 'no such card' }, { status: 404 });
  const img: ImageResponse = await cardImage(card.view, f as CardFormat);
  // a referee can still change a light until the board is final, so the card is cached only briefly
  img.headers.set('Cache-Control', 'public, max-age=60');
  return img;
}
