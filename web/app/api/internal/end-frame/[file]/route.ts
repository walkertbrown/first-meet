// GET /api/internal/end-frame/<attempt>.png?t=&s= (item 101, look 9 "The bomb-out clip"): a bomb-out clip's end
// frame, 1080 × 1920, for render_clip. She has no card link, so this isn't public: the link is signed with
// JUDGE_CALLBACK_SECRET by the clip job and lasts the run's lease. A bad or old link, or no such lift: 404.
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { attempts, lifters, meets } from '@/db/schema';
import { bestLiftView, endFrameOk } from '@/lib/card/best-lift';
import { bestLiftImage } from '@/lib/card/card-png';
import type { Units } from '@/lib/meet';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const none = () => Response.json({ error: 'no such frame' }, { status: 404 });

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const m = file.match(/^([0-9a-f-]{36})\.png$/);
  const q = new URL(req.url).searchParams;
  if (!m || !endFrameOk(m[1], q.get('t'), q.get('s'), process.env.JUDGE_CALLBACK_SECRET)) return none();
  if (!hasDb()) return Response.json({ error: 'no database' }, { status: 503 });
  const [row] = await db().select({ a: attempts, l: lifters }).from(attempts).innerJoin(lifters, eq(lifters.id, attempts.lifterId)).where(eq(attempts.id, m[1]));
  if (!row || row.a.call !== 'white') return none();
  const [meet] = row.l.meetId ? await db().select({ name: meets.name }).from(meets).where(eq(meets.id, row.l.meetId)) : [];
  const img = await bestLiftImage(bestLiftView({ ...row.l, units: row.l.units as Units }, meet?.name ?? null, row.a));
  img.headers.set('Cache-Control', 'no-store');
  return img;
}
