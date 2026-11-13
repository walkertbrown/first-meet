// The Barbell bench's void (plan 3.4b, item 74): no "Start!" out of the rack. The phone called "Rack!"
// and said "We lost the bar."; nothing was filmed for the judges. The attempt stays as it was (she films
// it again, or it stays unfilmed if she closes the app): item 93 keeps it `declared` and the server writes a
// `lost_bar_void` event, for /ops "No Start!, filmed again" (2.4).
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts } from '@/db/schema';
import { logEvent } from '@/lib/queue';

export async function lostBarVoid(db: Db, attemptId: string, lifterId: string): Promise<{ status: 200 | 403 | 404 | 409; body: Record<string, unknown> }> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return { status: 404, body: { error: 'no such attempt' } };
  const [a] = await db.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!a) return { status: 404, body: { error: 'no such attempt' } };
  if (a.lifterId !== lifterId) return { status: 403, body: { error: 'not your attempt' } };
  // a Home "bench" is the overhead press (3.4c), judged by its pose: only the Barbell bench follows the bar
  if (a.lift !== 'bench' || a.repsDeclared !== null) return { status: 409, body: { error: 'not a Barbell bench' } };
  // only before anything was sent: an attempt on its way to the judges is past this
  if (a.status !== 'declared') return { status: 409, body: { error: 'already filmed' } };
  await logEvent(db, 'lost_bar_void', { lift: a.lift, why: 'no_start' }, a.id);
  return { status: 200, body: { ok: true } };
}
