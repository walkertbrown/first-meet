// Her cards drawn ahead (NerdCider, 64d5e85; The Playner's point 4): when her total or bomb-out settles and her
// clip is queued, her Story and Post (or a bomb-out's end frame) join the drawing line behind every card a
// person or a clip run is waiting on. Her card page, her card link, the link previews and the clip's end card
// then mostly find a drawing already kept. The views are built exactly as the routes build them, so the
// drawings have the same content, and so the same key.
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, lifters, meets } from '@/db/schema';
import { bestLiftView, type BestLiftView } from '@/lib/card/best-lift';
import { cardFor } from '@/lib/card/card-data';
import { drawCardsAhead, drawEndFrameAhead } from '@/lib/card/card-png';
import type { LifterRow } from '@/lib/meet-flow';
import type { Units } from '@/lib/meet';

/** A bomb-out clip's end frame view for this good attempt (the end-frame route draws it), or null. */
export async function endFrameView(db: Db, attemptId: string): Promise<BestLiftView | null> {
  const [row] = await db.select({ a: attempts, l: lifters }).from(attempts).innerJoin(lifters, eq(lifters.id, attempts.lifterId)).where(eq(attempts.id, attemptId));
  if (!row || row.a.call !== 'white') return null;
  const [meet] = row.l.meetId ? await db.select({ name: meets.name }).from(meets).where(eq(meets.id, row.l.meetId)) : [];
  return bestLiftView({ ...row.l, units: row.l.units as Units }, meet?.name ?? null, row.a);
}

/** Off in the db tests (CARD_DRAW_AHEAD=off), whose hundreds of totals would each draw two cards. */
export const drawAheadOn = () => process.env.CARD_DRAW_AHEAD !== 'off';

/**
 * Queues her cards to be drawn ahead and returns once they're in line (the drawing goes on after).
 * Never fails the caller: a card not drawn ahead is drawn when it's asked for.
 */
export async function drawAhead(db: Db, l: LifterRow, it: { bombed: boolean; attemptId: string }, now = new Date()): Promise<void> {
  if (!drawAheadOn()) return;
  try {
    if (it.bombed) {
      const v = await endFrameView(db, it.attemptId);
      if (v) void drawEndFrameAhead(v);
    } else {
      const card = await cardFor(db, l, now);
      if (card) void drawCardsAhead(card.view);
    }
  } catch (e) {
    console.log(JSON.stringify({ msg: 'cards not drawn ahead', lifter_id: l.id, error: (e as Error).message }));
  }
}
