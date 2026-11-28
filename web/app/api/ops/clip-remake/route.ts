// /ops "Try again" on an "Old total on her clip" (item 119, held behind ITEM_119=on): her clip, whose making
// again for a changed end card failed twice, is tried once more now. Admins only.
import { db, hasDb } from '@/db';
import { hasRole } from '@/lib/guard';
import { remakeOn, retryRemake } from '@/lib/card/clip-remake';
import { viewerOf } from '@/lib/roles';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!remakeOn() || !hasDb()) return new Response('Not found', { status: 404 });
  const v = await viewerOf(db(), sessionFrom(req));
  if (!hasRole(v, 'admin')) return new Response('Admins only', { status: 403 });
  const form = await req.formData().catch(() => null);
  const id = String(form?.get('attempt') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Unknown clip', { status: 400 });
  await retryRemake(db(), id);
  return new Response(null, { status: 303, headers: { location: '/ops' } });
}

export const GET = () => new Response('Not found', { status: 404 });
