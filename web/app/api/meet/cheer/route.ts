// POST /api/meet/cheer {attempt_id, kind}: she cheers a flightmate's attempt from the flight strip
// (plan 5.24, look 5.8). One cheer per attempt, from her.
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { lifters } from '@/db/schema';
import { sendFlightCheer } from '@/lib/cheers';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in first' }, { status: 401 });
  const [l] = await db().select().from(lifters).where(eq(lifters.id, s.lifterId));
  if (!l || l.deletedAt) return Response.json({ error: 'sign in first' }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: 'json, please' }, { status: 400 });
  const r = await sendFlightCheer(db(), l, body);
  return r.status === 200 ? Response.json({ kind: r.kind }) : Response.json({ error: r.error }, { status: r.status });
}
