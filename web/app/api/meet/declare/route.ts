// GET /api/meet/declare: what "Declare your next attempt" offers now (plan 5.26).
// POST /api/meet/declare {value}: declares it, checked against the same choices (an opener takes none).
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { lifters } from '@/db/schema';
import { declareNext, declareSheet } from '@/lib/meet-flow';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

async function lifterOf(req: Request) {
  const s = sessionFrom(req);
  if (!s) return null;
  const [l] = await db().select().from(lifters).where(eq(lifters.id, s.lifterId));
  return l && !l.deletedAt ? l : null;
}

export async function GET(req: Request) {
  const l = await lifterOf(req);
  if (!l) return Response.json({ error: 'sign in first' }, { status: 401 });
  return Response.json(await declareSheet(db(), l));
}

export async function POST(req: Request) {
  const l = await lifterOf(req);
  if (!l) return Response.json({ error: 'sign in first' }, { status: 401 });
  const body = await req.json().catch(() => null) as { value?: unknown } | null;
  const value = typeof body?.value === 'number' ? body.value : null;
  const r = await declareNext(db(), l, value);
  if (r.status !== 200) return Response.json({ error: r.error }, { status: r.status });
  const a = r.attempt;
  return Response.json({ attempt: { id: a.id, lift: a.lift, number: a.number, weight: a.weight, reps_declared: a.repsDeclared, status: a.status } });
}
