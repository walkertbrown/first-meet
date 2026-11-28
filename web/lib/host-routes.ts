// The desk's two writes (plan 5.35), shared by /api/host/* (hosts and admins, the real meet) and
// /api/host/sample/* (anyone, demo lifters only: 5.36).
//   POST read    { lifter }    -> Soo tapped "Read"
//   POST crossed { lifters[] } -> these names crossed the middle of the band
import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { lifters, meets, readouts } from '@/db/schema';
import { hostMeet, readIds, recordReadout, sampleDeskLifters, type MeetRow } from '@/lib/host-data';
import { viewerOf } from '@/lib/roles';
import { sessionFrom } from '@/lib/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (v: unknown) => (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 200);

/** The meet and the lifters a desk may write for, or a refusal. */
async function deskFor(req: Request, sample: boolean): Promise<{ meet: MeetRow; allowed: Set<string> } | Response> {
  if (sample) {
    const { demo, meetId } = await sampleDeskLifters(db());
    const [meet] = meetId ? await db().select().from(meets).where(eq(meets.id, meetId)) : [];
    // a made-up lifter's read is the desk's alone: nothing to record
    if (!meet) return Response.json({ recorded: [] });
    return { meet, allowed: new Set(demo.map(d => d.id)) };
  }
  const v = await viewerOf(db(), sessionFrom(req));
  if (!v) return Response.json({ error: 'sign in first' }, { status: 401 });
  if (!v.isHost && !v.isAdmin) return Response.json({ error: 'hosts only' }, { status: 403 });
  const meet = await hostMeet(db());
  if (!meet) return Response.json({ error: 'no meet' }, { status: 404 });
  const people = await db().select({ id: lifters.id }).from(lifters).where(eq(lifters.meetId, meet.id));
  return { meet, allowed: new Set(people.map(p => p.id)) };
}

export async function deskPost(req: Request, kind: 'read' | 'rollcall', sample: boolean) {
  const body = await req.json().catch(() => null) as { lifter?: unknown; lifters?: unknown } | null;
  if (!body) return Response.json({ error: 'json, please' }, { status: 400 });
  const want = ids(kind === 'read' ? body.lifter : body.lifters);
  const desk = await deskFor(req, sample);
  if (desk instanceof Response) return desk;
  const { meet, allowed } = desk;
  let todo = want.filter(id => allowed.has(id));
  if (kind === 'rollcall' && todo.length) {
    if (sample) {
      // the sample desk loops: a name crossing again within the minute isn't news
      const recent = await db().select({ id: readouts.lifterId }).from(readouts)
        .where(and(eq(readouts.meetId, meet.id), eq(readouts.kind, 'rollcall'), inArray(readouts.lifterId, todo), gte(readouts.at, new Date(Date.now() - 60_000))));
      const skip = new Set(recent.map(r => r.id));
      todo = todo.filter(id => !skip.has(id));
    } else {
      // a reload of the real desk never crosses a name twice
      const done = await readIds(db(), meet.id, 'rollcall');
      todo = todo.filter(id => !done.has(id));
    }
  }
  const recorded: string[] = [];
  for (const lifterId of todo) recorded.push((await recordReadout(db(), { meet, lifterId, kind })).id);
  return Response.json({ recorded });
}
