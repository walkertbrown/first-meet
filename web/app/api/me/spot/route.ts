// GET /api/me/spot: her attempts a spot check changed (plan 5.27, item 105), for the banner she sees
// the next time she opens First Meet. Her phone keeps which ones she has seen.
import { and, eq, sql } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { attempts, lifters } from '@/db/schema';
import { sessionFrom } from '@/lib/session';
import { spotBanners } from '@/lib/referee/spot';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const s = sessionFrom(req);
  if (!s || !hasDb()) return Response.json([], { headers: { 'cache-control': 'no-store' } });
  const [l] = await db().select({ division: lifters.division, units: lifters.units }).from(lifters).where(eq(lifters.id, s.lifterId));
  if (!l) return Response.json([]);
  const rows = await db().select().from(attempts).where(and(eq(attempts.lifterId, s.lifterId), sql`${attempts.measures} ? 'spot_check'`));
  return Response.json(spotBanners(rows, l), { headers: { 'cache-control': 'no-store' } });
}
