// Meet control's form (plan 5.35): admins and the host. Each button posts `do` and its fields, then
// back to /host/control with what happened.
import { db, hasDb } from '@/db';
import { controlMeet, parseControl, runControl } from '@/lib/meet-control';
import { viewerOf } from '@/lib/roles';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

const back = (q: Record<string, string>) => new Response(null, { status: 303, headers: { location: `/host/control?${new URLSearchParams(q)}` } });

export async function POST(req: Request) {
  if (!hasDb()) return new Response('Not found', { status: 404 });
  const v = await viewerOf(db(), sessionFrom(req));
  if (!v) return new Response('Sign in first', { status: 401 });
  if (!v.isHost && !v.isAdmin) return new Response('Hosts only', { status: 403 });
  const form = await req.formData().catch(() => null);
  const f = (k: string) => { const x = form?.get(k); return typeof x === 'string' ? x : null; };
  // the meet the page showed, so a post acts on it and the page comes back to it
  const meet = await controlMeet(db(), f('meet'));
  if (!meet) return back({ note: 'No meet yet.' });
  const a = parseControl(f);
  if ('error' in a) return back({ note: a.error, at: f('do') ?? '', meet: meet.slug });
  const r = await runControl(db(), meet, a);
  return back({ ...(r.note ? { note: r.note } : r.ok ? { saved: a.do } : {}), at: a.do, meet: meet.slug });
}

export const GET = () => new Response('Not found', { status: 404 });
