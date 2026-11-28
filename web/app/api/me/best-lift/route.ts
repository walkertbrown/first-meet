// GET /api/me/best-lift: {ready, failed} for 5.28's "YOUR BEST LIFT" while "Your clip is being made" (item 101).
// POST /api/me/best-lift: "Try again" when it couldn't be made (item 102); offered once, so a second tap changes nothing.
// Only hers: a bomb-out's clip has no card link, and nothing here makes it public.
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters } from '@/db/schema';
import { bestLiftFor, retryBestLift } from '@/lib/card/best-lift-data';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

async function lifterOf(req: Request) {
  const s = sessionFrom(req);
  if (!s) return null;
  const [l] = await db().select().from(lifters).where(eq(lifters.id, s.lifterId));
  return l && !l.deletedAt ? l : null;
}

export async function GET(req: Request) {
  if (!hasDb()) return Response.json({ error: 'no database' }, { status: 503 });
  const l = await lifterOf(req);
  if (!l) return Response.json({ error: 'sign in first' }, { status: 401 });
  const b = await bestLiftFor(db(), l);
  if (!b) return Response.json({ error: 'no best lift' }, { status: 404 });
  return Response.json({ ready: b.ready, failed: b.failed }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  if (!hasDb()) return Response.json({ error: 'no database' }, { status: 503 });
  const l = await lifterOf(req);
  if (!l) return Response.json({ error: 'sign in first' }, { status: 401 });
  return await retryBestLift(db(), l)
    ? Response.json({ queued: true })
    : Response.json({ error: 'nothing to try again' }, { status: 409 });
}
