// GET /api/meet-week/openers: her openers' choices and what she saved (plan 5.23).
// POST /api/meet-week/openers {picks: [{lift, weight, reps?}]}: "Save my openers", checked against the same choices.
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { lifters, type Lift } from '@/db/schema';
import { LIFTS } from '@/lib/meet';
import { meetWeekPlace, saveOpeners, type OpenerPick } from '@/lib/meet-week';
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
  const p = await meetWeekPlace(db(), l);
  if (p.kind !== 'week') return Response.json({ error: 'meet week is not on' }, { status: 409 });
  return Response.json({ openers: p.view.openers });
}

export async function POST(req: Request) {
  const l = await lifterOf(req);
  if (!l) return Response.json({ error: 'sign in first' }, { status: 401 });
  const body = await req.json().catch(() => null) as { picks?: unknown } | null;
  const raw = Array.isArray(body?.picks) ? body.picks : null;
  if (!raw) return Response.json({ error: 'picks' }, { status: 422 });
  const picks: OpenerPick[] = [];
  for (const x of raw as { lift?: unknown; weight?: unknown; reps?: unknown }[]) {
    if (!x || !LIFTS.includes(x.lift as Lift) || typeof x.weight !== 'number') return Response.json({ error: 'picks' }, { status: 422 });
    picks.push({ lift: x.lift as Lift, weight: x.weight, reps: typeof x.reps === 'number' ? x.reps : null });
  }
  const r = await saveOpeners(db(), l, picks);
  if (r.status !== 200) return Response.json({ error: r.error }, { status: r.status });
  const p = await meetWeekPlace(db(), (await db().select().from(lifters).where(eq(lifters.id, l.id)))[0]);
  return Response.json({ openers: p.kind === 'week' ? p.view.openers : [] });
}
