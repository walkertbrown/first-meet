// GET /api/me/card/share-clip: {ready, failed, shared}, for 5.30's Clip while "Your clip is being made".
// POST /api/me/card/share-clip {via}: a tap on 5.30's Clip segment.
// - "share" or "copy" ("Share", "Copy my card link"), the first time (item 99): her card clip goes on her card
//   link; her other videos don't change.
// - "share" or "save" ("Save to my phone"): this is the clip she sent, so a clip made again later for a new
//   total says so on this segment (item 119). "Save" doesn't put it on her card link: that file stays with her.
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters } from '@/db/schema';
import { cardFor, clipState, shareCardClip } from '@/lib/card/card-data';
import { queueOnRead } from '@/lib/card/clip-job';
import { markClipSent } from '@/lib/card/clip-remake';
import { logEvent } from '@/lib/queue';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

async function cardOf(req: Request) {
  const s = sessionFrom(req);
  if (!s) return null;
  const [l] = await db().select().from(lifters).where(eq(lifters.id, s.lifterId));
  if (!l || l.deletedAt) return null;
  return cardFor(db(), l);
}

export async function GET(req: Request) {
  if (!hasDb()) return Response.json({ error: 'no database' }, { status: 503 });
  const card = await cardOf(req);
  if (!card) return Response.json({ error: 'no card' }, { status: 401 });
  // her Clip segment asks every 8 s: a total that settled with no new lights is queued now
  if (card.clip && await queueOnRead(db(), card.lifter.id, card.clip.attemptId, card.clip.status)) card.clip.status = 'queued';
  return Response.json({ ...clipState(card.clip), shared: !!card.clip?.sharedAt }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (!hasDb()) return Response.json({ error: 'no database' }, { status: 503 });
  const card = await cardOf(req);
  if (!card) return Response.json({ error: 'sign in first' }, { status: 401 });
  const l = card.lifter;
  if (!card?.clip || card.clip.status !== 'ready') return Response.json({ error: 'no clip yet' }, { status: 409 });
  const body = await req.json().catch(() => null) as { via?: unknown } | null;
  // an older page posts no body: that was "Share" or "Copy my card link"
  const via = body?.via === 'save' || body?.via === 'copy' ? body.via : body?.via === 'share' ? 'share' : 'copy';
  if (via !== 'save') {
    const first = await shareCardClip(db(), l.id, card.clip.attemptId);
    if (first) await logEvent(db(), 'clip_shared', { lifter_id: l.id }, card.clip.attemptId);
  }
  if (via !== 'copy') await markClipSent(db(), l.id, card.clip.attemptId);
  return Response.json({ shared: via !== 'save' });
}
