// POST /api/me/card/retry-clip: "Try again" on 5.30's Clip segment when her clip couldn't be made (item 102).
// It's queued once more and the segment shows the making line; offered once, so a second tap changes nothing.
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters } from '@/db/schema';
import { cardFor } from '@/lib/card/card-data';
import { retryClip } from '@/lib/card/clip-job';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!hasDb()) return Response.json({ error: 'no database' }, { status: 503 });
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in first' }, { status: 401 });
  const [l] = await db().select().from(lifters).where(eq(lifters.id, s.lifterId));
  if (!l || l.deletedAt) return Response.json({ error: 'sign in first' }, { status: 401 });
  const card = await cardFor(db(), l);
  if (!card?.clip) return Response.json({ error: 'no card' }, { status: 409 });
  const ok = await retryClip(db(), l.id, card.clip.attemptId);
  return ok ? Response.json({ queued: true }) : Response.json({ error: 'nothing to try again' }, { status: 409 });
}
