// The Barbell bench's void (plan 3.4b, item 74): no "Start!" out of the rack. The phone called "Rack!"
// and said "We lost the bar."; nothing was filmed for the judges. The attempt stays as it was (she films
// it again, or it stays unfilmed if she closes the app): item 93 keeps it `declared` and the server writes a
// `lost_bar_void` event, for /ops "No Start!, filmed again" (2.4).
// Item 112: the row carries `n`, the voids in a row on this attempt (its `lost_bar_void` rows since its last
// `upload_started`, this one included; a `turned_void` never resets it), and the answer gives it back, so the phone's
// second sheet ("We lost the bar again") comes from the server's count when it answers in time.
import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts } from '@/db/schema';
import { VOID_WHYS, type VoidWhy } from '@/lib/judge/bar-caller';
import { logEvent } from '@/lib/queue';

/** The phone's cause (item 112), or `no_start` from a page older than the causes. */
export const voidWhy = (w: unknown): VoidWhy | 'no_start' => (VOID_WHYS.includes(w as VoidWhy) ? (w as VoidWhy) : 'no_start');

export async function lostBarVoid(db: Db, attemptId: string, lifterId: string, why: unknown = null): Promise<{ status: 200 | 403 | 404 | 409; body: Record<string, unknown> }> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return { status: 404, body: { error: 'no such attempt' } };
  const [a] = await db.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!a) return { status: 404, body: { error: 'no such attempt' } };
  if (a.lifterId !== lifterId) return { status: 403, body: { error: 'not your attempt' } };
  // a Home "bench" is the overhead press (3.4c), judged by its pose: only the Barbell bench follows the bar
  if (a.lift !== 'bench' || a.repsDeclared !== null) return { status: 409, body: { error: 'not a Barbell bench' } };
  // only before anything was sent: an attempt on its way to the judges is past this
  if (a.status !== 'declared') return { status: 409, body: { error: 'already filmed' } };
  const [c] = await db.execute<{ n: number }>(sql`select count(*)::int as n from events
    where attempt_id = ${a.id} and kind = 'lost_bar_void'
      and at >= coalesce((select max(s.at) from events s where s.attempt_id = ${a.id} and s.kind = 'upload_started'), '-infinity')`);
  const n = Number(c?.n ?? 0) + 1;
  await logEvent(db, 'lost_bar_void', { lift: a.lift, why: voidWhy(why), n }, a.id);
  return { status: 200, body: { ok: true, n } };
}
