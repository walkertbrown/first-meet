// POST /api/demo/sample {attempt_id}: "Use a sample lift instead" (plan 5.36), through the real
// server path: R2 copy, stored command times, the queue, the Workflow, the lights.
import { db } from '@/db';
import { sampleLift } from '@/lib/demo';
import { r2 } from '@/lib/r2';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const s = sessionFrom(req);
  if (!s || s.kind !== 'demo') return Response.json({ error: 'demo lifters only' }, { status: 401 });
  const body = await req.json().catch(() => null) as { attempt_id?: unknown } | null;
  if (typeof body?.attempt_id !== 'string') return Response.json({ error: 'attempt_id is needed' }, { status: 400 });
  const { status, ...rest } = await sampleLift(db(), r2(), s.lifterId, body.attempt_id);
  return Response.json(rest, { status });
}
