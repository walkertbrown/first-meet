// GET /api/meet-week/openers: her openers' choices and what she saved (plan 5.23).
// POST /api/meet-week/openers {picks: [{lift, weight, reps?}]}: "Save my openers", checked against the same choices.
// The same POST as a plain form ("Save my openers" tapped before the page's script ran): the radios
// opener-<lift> (Barbell) or weight-<lift> and reps-<lift> (Home); it answers with a 303 back to /meet-week.
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { lifters, type Lift } from '@/db/schema';
import { LIFTS } from '@/lib/meet';
import { meetWeekPlace, saveOpeners, type OpenerPick } from '@/lib/meet-week';
import { formPicks } from '@/lib/opener-form';
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

const back = (ok: boolean) => new Response(null, { status: 303, headers: { location: ok ? '/meet-week' : '/meet-week?openers=again', 'cache-control': 'no-store' } });

export async function POST(req: Request) {
  const l = await lifterOf(req);
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    if (!l) return new Response(null, { status: 303, headers: { location: '/' } });
    const picks = formPicks(await req.formData().catch(() => new FormData()));
    return back(!!picks && (await saveOpeners(db(), l, picks)).status === 200);
  }
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
