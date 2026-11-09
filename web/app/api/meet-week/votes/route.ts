// PUT /api/meet-week/votes {slots: number[]}: every hour that works for her (plan 5.23), until the hour is set.
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { lifters } from '@/db/schema';
import { saveVotes } from '@/lib/meet-week';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  const s = sessionFrom(req);
  if (!s) return Response.json({ error: 'sign in first' }, { status: 401 });
  const [l] = await db().select().from(lifters).where(eq(lifters.id, s.lifterId));
  if (!l || l.deletedAt) return Response.json({ error: 'sign in first' }, { status: 401 });
  const body = await req.json().catch(() => null) as { slots?: unknown } | null;
  if (!Array.isArray(body?.slots)) return Response.json({ error: 'slots' }, { status: 422 });
  const r = await saveVotes(db(), l, body.slots as number[]);
  if (r.status !== 200) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ counts: r.counts, mine: r.mine });
}
