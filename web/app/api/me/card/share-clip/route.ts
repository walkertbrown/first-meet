// GET /api/me/card/share-clip: {ready, shared}, for 5.30's Clip while "Your clip is being made".
// POST /api/me/card/share-clip: "Share" or "Copy my card link" on 5.30's Clip segment, the first time
// (item 99). Her card clip goes on her card link; her other videos don't change. "Save to my phone" doesn't
// call this: that file stays with her.
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters } from '@/db/schema';
import { cardFor, shareCardClip } from '@/lib/card/card-data';
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
  return Response.json({ ready: card.clip?.status === 'ready' && !!card.clip.key, shared: !!card.clip?.sharedAt }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (!hasDb()) return Response.json({ error: 'no database' }, { status: 503 });
  const card = await cardOf(req);
  if (!card) return Response.json({ error: 'sign in first' }, { status: 401 });
  const l = card.lifter;
  if (!card?.clip || card.clip.status !== 'ready') return Response.json({ error: 'no clip yet' }, { status: 409 });
  const first = await shareCardClip(db(), l.id, card.clip.attemptId);
  if (first) await logEvent(db(), 'clip_shared', { lifter_id: l.id }, card.clip.attemptId);
  return Response.json({ shared: true });
}
