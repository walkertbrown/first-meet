'use client';
// Her name on Soo's live (plan 5.29, look 5.10 "Soo banners"): the roll call banner when her name
// crosses, and the bigger read-out sheet when Soo taps "Read". A demo read-out (from /host/sample)
// never uses Soo's name and has no "Watch the moment". Each one her phone shows is POSTed back, so
// its email doesn't go.
import { useCallback, useEffect, useRef, useState } from 'react';
import { keepFocus, useBannerRoom } from './banner-layer';
import { Lamps, type LampState } from './lamps';

export type PhoneReadout = { id: string; kind: 'read' | 'rollcall'; demo: boolean; at: string; watch: string | null; name: string };

export const readoutWords = (r: Pick<PhoneReadout, 'kind' | 'demo'>) => r.demo
  ? { eyebrow: 'SAMPLE MEET NIGHT', line: r.kind === 'read' ? 'Your name was read on the sample meet night' : 'Your name crossed the sample meet night.' }
  : { eyebrow: "ON SOO'S LIVE", line: r.kind === 'read' ? 'Soo just read your name!' : "You're on Soo's live right now." };

/** The read-outs not yet shown on this phone: a read before a roll call, oldest first. */
export function nextReadout(list: PhoneReadout[], shown: Set<string>): PhoneReadout | null {
  const left = list.filter(r => !shown.has(r.id));
  return left.find(r => r.kind === 'read') ?? left[0] ?? null;
}

function useReadoutFeed() {
  const [list, setList] = useState<PhoneReadout[]>([]);
  const load = useCallback(async () => {
    const r = await fetch('/api/readouts', { cache: 'no-store' }).catch(() => null);
    if (!r?.ok) return;
    const j = await r.json() as { readouts: PhoneReadout[] };
    setList(j.readouts);
  }, []);
  useEffect(() => {
    void load();
    const es = new EventSource('/api/live');
    es.addEventListener('readout', () => void load());
    // a phone that was asleep: anything from the last minute
    const wake = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', wake);
    return () => { es.close(); document.removeEventListener('visibilitychange', wake); };
  }, [load]);
  return list;
}

const seen = (ids: string[]) => fetch('/api/readouts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) }).catch(() => null);

/** On /live and the demo total: her read-outs as they happen. */
export function SooReadouts() {
  const list = useReadoutFeed();
  const shownIds = useRef(new Set<string>());
  const [shown, setShown] = useState<PhoneReadout | null>(null);
  useEffect(() => {
    if (shown) return;
    const r = nextReadout(list, shownIds.current);
    if (!r) return;
    // a roll call crossing under a read the same minute: the read says it all
    const also = r.kind === 'read' ? list.filter(x => x.kind === 'rollcall' && !shownIds.current.has(x.id)) : [];
    for (const x of [r, ...also]) shownIds.current.add(x.id);
    setShown(r);
    void seen([r.id, ...also.map(x => x.id)]);
  }, [list, shown]);
  const dismiss = useCallback(() => setShown(null), []);
  if (!shown) return null;
  return shown.kind === 'read' ? <ReadSheet r={shown} onDismiss={dismiss} /> : <SooBanner r={shown} onDismiss={dismiss} />;
}

/** The roll call banner: `--stage`, one lit white lamp, the Eyebrow, the line, "Watch the moment". 8 s or a tap. */
export function SooBanner({ r, onDismiss }: { r: PhoneReadout; onDismiss: () => void }) {
  const room = useBannerRoom<HTMLDivElement>();
  const w = readoutWords(r);
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [r.id, onDismiss]);
  return (
    <div className="banner soo-banner" role="status" ref={room} onMouseDown={keepFocus} onClick={onDismiss}>
      <i className="mini-lamp white soo-lamp" aria-hidden="true" />
      <span className="soo-words">
        <span className="eyebrow">{w.eyebrow}</span>
        <span className="body-l soo-line">{w.line}</span>
        {r.watch && <a className="soo-watch" href={r.watch} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>Watch the moment</a>}
      </span>
    </div>
  );
}

/** How slowly the sheet's lamps light: one every 700 ms (the referee's are 330 ms apart). */
export const SLOW_LAMP_MS = 700;

/** "Soo just read your name!": a full-width sheet from the top, the three lamps lighting slowly, her name in Page title. */
export function ReadSheet({ r, onDismiss }: { r: PhoneReadout; onDismiss: () => void }) {
  const w = readoutWords(r);
  const [lit, setLit] = useState(0);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (off) { setLit(3); return; }
    const ts = [1, 2, 3].map(n => setTimeout(() => setLit(n), 480 + (n - 1) * SLOW_LAMP_MS));
    return () => ts.forEach(clearTimeout);
  }, [r.id]);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    sheet.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); prev?.focus?.(); };
  }, [onDismiss]);
  const states: LampState[] = [0, 1, 2].map(i => (i < lit ? 'white' : 'off'));
  const words = lit >= 3;
  return (
    <>
      <div className="sheet-scrim soo-scrim" onClick={onDismiss} />
      <div className="soo-sheet" role="dialog" aria-modal="true" aria-labelledby="soo-name" tabIndex={-1} ref={sheet} onClick={onDismiss}>
        <Lamps states={states} size={44} className="lamps soo-lamps" />
        <div className={words ? 'soo-sheet-words fade-in' : 'soo-sheet-words waiting'}>
          <p className="eyebrow">{w.eyebrow}</p>
          <h2 className="page-title" id="soo-name">{r.name}</h2>
          <p className="body-l">{w.line}</p>
          {r.watch && <p><a className="soo-watch" href={r.watch} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>Watch the moment</a></p>}
        </div>
      </div>
    </>
  );
}
