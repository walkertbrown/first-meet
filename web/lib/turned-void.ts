// A phone that turned during the lift (plan 3.10): gravity past 60° for 500 ms from "Bar is loaded." on.
// The attempt is void, never judged, and "Film again" re-films the same attempt, so, like the bench's lost
// bar (lost-bar-void.ts), it stays declared and the server only counts it, for /ops "Bench, phone and
// referees" (2.4).
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts } from '@/db/schema';
import { logEvent } from '@/lib/queue';

export async function turnedVoid(db: Db, attemptId: string, lifterId: string): Promise<{ status: 200 | 403 | 404 | 409; body: Record<string, unknown> }> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return { status: 404, body: { error: 'no such attempt' } };
  const [a] = await db.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!a) return { status: 404, body: { error: 'no such attempt' } };
  if (a.lifterId !== lifterId) return { status: 403, body: { error: 'not your attempt' } };
  // only before anything was sent: an attempt on its way to the judges is past this
  if (a.status !== 'declared') return { status: 409, body: { error: 'already filmed' } };
  await logEvent(db, 'turned_void', { lift: a.lift }, a.id);
  return { status: 200, body: { ok: true } };
}
