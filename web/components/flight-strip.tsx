'use client';
// "Your flight is lifting" (plan 5.24, look 5.8): on the platform during flight time, her
// flightmates' attempts as they land, newest first, each with "Cheer". In phase 3 this is the demo
// flight (5.36), read from the clock in the browser: nothing to fetch until she cheers.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheerSheet } from '@/components/corner';
import { CHEERS, type CheerKind } from '@/lib/cheer-words';
import { demoFlightAt, rowsThatFit, type FlightRow } from '@/lib/demo-flight';

const SENT_KEY = 'fm-cheers-flight';
const MAX_ROWS = 3;
function readSent(): Record<string, CheerKind> {
  try { return JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}') as Record<string, CheerKind>; } catch { return {}; }
}
function writeSent(v: Record<string, CheerKind>) {
  // only this weekend's ids are worth keeping: the last 60
  try { localStorage.setItem(SENT_KEY, JSON.stringify(Object.fromEntries(Object.entries(v).slice(-60)))); } catch { /* no storage */ }
}

export function DemoFlightStrip({ division, units, cardName }: { division: 'barbell' | 'home'; units: 'lb' | 'kg'; cardName: string }) {
  const [now, setNow] = useState<Date | null>(null);
  const [sent, setSent] = useState<Record<string, CheerKind>>({});
  const [sheet, setSheet] = useState<FlightRow | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const strip = useRef<HTMLElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const rowH = useRef(65);
  const [fit, setFit] = useState(MAX_ROWS);

  // Look 5.8 "Height": as many rows as leave "I'm ready" on the visible screen. Counted again on
  // load, resize or turning, when anything above changes height, and when a row lands; never on scroll.
  const count = useCallback(() => {
    const el = strip.current;
    const btn = el?.closest('main')?.querySelector<HTMLElement>('.try-actions .btn');
    if (!el || !btn) return;
    const row = el.querySelector<HTMLElement>('.flight-row');
    if (row) rowH.current = row.getBoundingClientRect().height;
    const safe = probe.current ? parseFloat(getComputedStyle(probe.current).paddingBottom) || 0 : 0;
    const screen = (window.visualViewport?.height ?? window.innerHeight) - safe;
    const bottom = btn.getBoundingClientRect().bottom + window.scrollY;
    setFit(shown => rowsThatFit({ shown, max: MAX_ROWS, bottom, screen, rowH: rowH.current }));
  }, []);
  useEffect(() => {
    const vv = window.visualViewport;
    vv?.addEventListener('resize', count);
    window.addEventListener('resize', count);
    window.addEventListener('orientationchange', count);
    const main = strip.current?.closest('main');
    const ro = typeof ResizeObserver !== 'undefined' && main ? new ResizeObserver(() => count()) : null;
    if (main) for (const c of Array.from(main.children)) if (c !== strip.current) ro?.observe(c);
    return () => {
      vv?.removeEventListener('resize', count);
      window.removeEventListener('resize', count);
      window.removeEventListener('orientationchange', count);
      ro?.disconnect();
    };
  }, [count]);

  useEffect(() => { setNow(new Date()); setSent(readSent()); }, []);
  const flight = now ? demoFlightAt(now, division, units, MAX_ROWS) : null;
  // a row landing: the newest slides in at the top and the oldest shown goes, then count again
  useLayoutEffect(count, [count, flight?.rows[0]?.id]);
  const rows = flight ? flight.rows.slice(0, fit) : [];
  useEffect(() => {
    if (!flight) return;
    const t = setTimeout(() => setNow(new Date()), Math.max(200, flight.nextAt - Date.now() + 50));
    return () => clearTimeout(t);
  }, [flight?.nextAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // only a row that lands while she's here slides in and lights up (look 5.8)
  const fresh = new Set<string>();
  if (flight && seen.current) for (const r of rows) if (!seen.current.has(r.id)) fresh.add(r.id);
  useEffect(() => { if (flight) seen.current = new Set(flight.rows.map(r => r.id)); });

  const send = async (row: FlightRow, kind: CheerKind) => {
    setSent(s => { const n = { ...s, [row.id]: kind }; writeSent(n); return n; });
    const r = await fetch('/api/meet/cheer', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attempt_id: row.id, kind }) }).catch(() => null);
    if (!r || (!r.ok && r.status !== 409)) setSent(s => { const n = { ...s }; delete n[row.id]; writeSent(n); return n; });
  };

  return (
    <section className="flight-strip" aria-label="Your flight is lifting" ref={strip}>
      <span className="safe-probe" ref={probe} aria-hidden="true" />
      <header className="flight-head">
        <span className="eyebrow">Your flight is lifting</span>
        <span className="caption">Demo flight</span>
      </header>
      {rows.length > 0 && (
        <ul className="flight-list" aria-live="polite">
          {rows.map(r => (
            <li key={r.id} className={fresh.has(r.id) ? 'flight-row arrive' : 'flight-row'}>
              <div className="corner-what">
                <span className="corner-name">{r.name}</span>
                <span className="small">{r.what}</span>
              </div>
              <span className="lamps-mini" role="img" aria-label={r.lights.filter(l => l === 'white').length >= 2 ? 'Good lift' : 'No lift'}>
                {r.lights.map((l, i) => <i key={i} className={`mini-lamp ${l}`} style={{ '--i': i } as React.CSSProperties} />)}
              </span>
              {sent[r.id]
                ? <span className="cheer-btn sent">{CHEERS[sent[r.id]]}</span>
                : <button type="button" className="cheer-btn" onClick={() => setSheet(r)}>Cheer</button>}
            </li>
          ))}
        </ul>
      )}
      {sheet && (
        <CheerSheet
          lifter={sheet.name} row={{ name: sheet.what.split(' · ')[0] }} name={cardName}
          onClose={() => setSheet(null)}
          onSend={kind => { void send(sheet, kind); }}
        />
      )}
    </section>
  );
}
