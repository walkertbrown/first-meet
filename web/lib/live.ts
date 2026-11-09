// Live updates (plan 3.9 step 7): one LISTEN on fm_live per web process, fanned out to every
// server-sent-events stream in it. A second web instance has its own LISTEN, so it stays right.
import type { Db } from '@/db';
import { LIVE_CHANNEL, type LiveEvent } from '@/lib/queue';

type Sub = (e: LiveEvent) => void;
const g = globalThis as unknown as { __fmLive?: { subs: Set<Sub>; listening: Promise<unknown> | null } };

export function subscribe(db: Db, fn: Sub): () => void {
  const s = (g.__fmLive ??= { subs: new Set(), listening: null });
  s.subs.add(fn);
  // postgres.js keeps the LISTEN connection and reconnects it on its own
  s.listening ??= db.$client.listen(LIVE_CHANNEL, payload => {
    let e: LiveEvent;
    try { e = JSON.parse(payload) as LiveEvent; } catch { return; }
    for (const f of s.subs) { try { f(e); } catch { /* one stream's trouble isn't another's */ } }
  }).catch(err => {
    console.log(JSON.stringify({ msg: 'live listen failed', error: (err as Error).message }));
    s.listening = null;
  });
  return () => { s.subs.delete(fn); };
}

/** Settles once this process's LISTEN is in place: an event published after it is heard. */
export const listening = async () => { await g.__fmLive?.listening; };

/** Whether a stream for this lifter, watching this attempt, gets the event. Only her own. */
export const isFor = (e: LiveEvent, lifterId: string, attemptId: string | null) =>
  e.kind === 'attempt' && (('lifter_id' in e && e.lifter_id === lifterId) || (!!attemptId && e.attempt_id === attemptId && !e.lifter_id));
