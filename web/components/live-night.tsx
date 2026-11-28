'use client';
// Meet night, live (plan 5.6, 5.29): the countdown, the board with its filters and search, and the
// poll that keeps the page live (anyone can watch, signed in or not, so it re-reads every 10 s).
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AGE_GROUPS, boardRows, shownRows, type BoardLifter, type Division } from '@/lib/board';
import { countdown } from '@/lib/live-page';
import { Board, BOARD_EMPTY } from './board';

export const LIVE_POLL_MS = 10_000;

/** Re-reads the page every 10 s while it's on screen, and once when it comes back. */
export function LivePoll({ ms = LIVE_POLL_MS }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, ms);
    const back = () => { if (document.visibilityState === 'visible') router.refresh(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', back); };
  }, [router, ms]);
  return null;
}

/** "Soo is live in <h:mm:ss>"; at zero the page re-reads and the stream takes its place. */
export function LiveCountdown({ at }: { at: string }) {
  const router = useRouter();
  const target = useMemo(() => new Date(at).getTime(), [at]);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= target) { clearInterval(id); router.refresh(); }
    }, 1000);
    return () => clearInterval(id);
  }, [target, router]);
  return <h1 className="page-title">Soo is live in <span className="num live-clock">{now == null ? '' : countdown(target - now)}</span></h1>;
}

const AGES = [null, ...AGE_GROUPS] as const;

/** The board (5.6, look 5.11): Barbell or Home, an age group, and "Find a lifter". Her row marked. */
export function LiveBoard({ lifters, meId, start = 'barbell', empty = BOARD_EMPTY, notes, heading = 'THE BOARD' }: {
  lifters: BoardLifter[]; meId?: string | null; start?: Division; empty?: string; notes?: Record<string, string>; heading?: string;
}) {
  const [division, setDivision] = useState<Division>(start);
  const [age, setAge] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const all = useMemo(() => boardRows(lifters, division), [lifters, division]);
  const rows = useMemo(() => shownRows(all, age, q), [all, age, q]);
  const anyone = lifters.some(l => boardRows([l], l.division).length);
  return (
    <section className="live-board" aria-labelledby="live-board-h">
      <h2 className="eyebrow" id="live-board-h">{heading}</h2>
      <div className="live-filters">
        <fieldset className="segments">
          <legend>Division</legend>
          {(['barbell', 'home'] as const).map(d => (
            <label key={d}><input type="radio" name="live-division" checked={division === d} onChange={() => setDivision(d)} />{d === 'home' ? 'Home' : 'Barbell'}</label>
          ))}
        </fieldset>
        <fieldset className="segments live-ages">
          <legend>Age group</legend>
          {AGES.map(g => (
            <label key={g ?? 'all'}><input type="radio" name="live-age" checked={age === g} onChange={() => setAge(g)} />{g ?? 'All ages'}</label>
          ))}
        </fieldset>
        <label className="live-find">
          <span className="sr">Find a lifter</span>
          <input type="search" placeholder="Find a lifter" value={q} onChange={e => setQ(e.currentTarget.value)} autoComplete="off" />
        </label>
      </div>
      {!anyone ? <p className="body board-empty">{empty}</p>
        : rows.length ? <Board rows={rows} division={division} meId={meId} notes={notes} caption={`Meet board, ${division === 'home' ? 'Home' : 'Barbell'}${age ? `, ${age}` : ''}`} />
        : <p className="body board-empty">{q.trim() ? `No lifter called “${q.trim()}” here.` : 'No totals here yet.'}</p>}
    </section>
  );
}
