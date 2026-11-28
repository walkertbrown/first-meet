// A person's spot check (plan 5.33): POST {lifter_id, outcome: 'checked' | 'problem', problems?: SpotProblem[]}.
// "Checked" puts back any spot-check red; "Problem" needs at least one problem. Referees only; refused once final.
import { db, hasDb } from '@/db';
import type { SpotProblem } from '@/db/schema';
import { hasRole } from '@/lib/guard';
import { decideSpot } from '@/lib/referee/spot';
import { viewerOf } from '@/lib/roles';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readProblems(raw: unknown): SpotProblem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SpotProblem[] = [];
  for (const p of raw as { kind?: unknown; attemptId?: unknown }[]) {
    if (p?.kind === 'not_same_lifter') out.push({ kind: 'not_same_lifter' });
    else if ((p?.kind === 'weight_not_visible' || p?.kind === 'arms_bent') && typeof p.attemptId === 'string' && UUID.test(p.attemptId)) out.push({ kind: p.kind, attemptId: p.attemptId });
    else return null;
  }
  return out;
}

export async function POST(req: Request) {
  if (!hasDb()) return Response.json({ error: 'no database' }, { status: 503 });
  const v = await viewerOf(db(), sessionFrom(req));
  if (!hasRole(v, 'referee')) return Response.json({ error: 'referees only' }, { status: 403 });
  const body = await req.json().catch(() => null) as { lifter_id?: unknown; outcome?: unknown; problems?: unknown } | null;
  if (!body || typeof body.lifter_id !== 'string' || !UUID.test(body.lifter_id)) return Response.json({ error: 'bad body' }, { status: 400 });
  const problems = body.outcome === 'problem' ? readProblems(body.problems) : [];
  if (body.outcome !== 'checked' && body.outcome !== 'problem') return Response.json({ error: 'bad outcome' }, { status: 400 });
  if (!problems || (body.outcome === 'problem' && !problems.length)) return Response.json({ error: 'pick a problem' }, { status: 400 });
  const r = await decideSpot(db(), body.lifter_id, v!.id, { outcome: body.outcome, problems });
  if (r === 'gone') return Response.json({ error: 'no such spot check' }, { status: 404 });
  if (r === 'final') return Response.json({ error: 'the board is final' }, { status: 409 });
  return Response.json({ ok: true });
}
