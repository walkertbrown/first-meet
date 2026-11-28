'use client';
// Soo's host desk (plan 5.35, look 5.12): a 1920 × 1080 canvas on --stage, screen-shared, scaled to
// fit whatever holds it. The read-out card with "Read" and "Skip", the count of first totals top
// right, and the roll call band along the bottom. Shared by /host, /host/sample and the sample
// meet's chapter 4 (5.3), where it's a picture: `inert`, driven by the replay's clock.
import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';

export const DESK_W = 1920, DESK_H = 1080;

/** Scales the 1920 × 1080 desk to its box's width, keeping 16:9. */
export function DeskStage({ children, label, inert = false }: { children: ReactNode; label: string; inert?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setK(el.clientWidth / DESK_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="desk-box" role={inert ? 'img' : 'region'} aria-label={label}>
      <div className="desk" style={{ transform: `scale(${k})`, visibility: k ? undefined : 'hidden' }} inert={inert || undefined} aria-hidden={inert || undefined}>
        {children}
      </div>
    </div>
  );
}

export type Readout = { id: string; name: string; sayIt?: string | null; ageGroup: string; division?: string | null; hometown?: string | null; total: string; units: string; line?: string | null };

export function ReadoutCard({ r, eyebrow, leaving = false }: { r: Readout; eyebrow: string; leaving?: boolean }) {
  const meta = [r.ageGroup, r.division, r.hometown].filter(Boolean).join(' · ');
  return (
    <article className={`desk-card${leaving ? ' leaving' : ''}`} key={r.id}>
      <span className="desk-eyebrow">{eyebrow}</span>
      <h2 className="desk-name">{r.name}</h2>
      {r.sayIt && <p className="desk-say">{r.sayIt}</p>}
      <p className="desk-meta">{meta}</p>
      <p className="desk-total"><span className="num">{r.total}</span><span className="desk-unit">{r.units}</span></p>
      {r.line && <p className="desk-line">{r.line}</p>}
    </article>
  );
}

export type RollEntry = { id: string; name: string; ageGroup: string; total: string };

/** One roll call row: a strip of entries, 64 px apart, moved left by `offset` px from the right edge. */
export const RollRow = forwardRef<HTMLDivElement, { entries: RollEntry[]; offset: number; lead?: number }>(function RollRow({ entries, offset, lead = 0 }, ref) {
  return (
    <div className="roll-row">
      <div ref={ref} className="roll-strip" style={{ transform: `translate3d(${DESK_W + lead - offset}px,0,0)` }}>
        {entries.map(e => (
          <span key={e.id} className="roll-entry" data-id={e.id}>
            <i className="mini-lamp white" aria-hidden="true" />
            <b className="roll-name">{e.name}</b>
            <span className="roll-age">{e.ageGroup}</span>
            <span className="roll-total num">{e.total}</span>
          </span>
        ))}
      </div>
    </div>
  );
});

/** The band: one row, or two (alternating names; the lower row starts half an average entry later). */
export function RollBand({ rows, offset, halfEntry = 160, refs }: { rows: RollEntry[][]; offset: number; halfEntry?: number; refs?: ((el: HTMLDivElement | null) => void)[] }) {
  return (
    <div className={`roll-band${rows.length > 1 ? ' two' : ''}`}>
      {rows.map((entries, i) => <RollRow key={i} ref={refs?.[i]} entries={entries} offset={offset} lead={i ? halfEntry : 0} />)}
    </div>
  );
}

/** The desk's top: the wordmark and the night on the left, the count on the right. */
export function DeskTop({ night, count }: { night: string; count: number }) {
  return (
    <header className="desk-top">
      <div><span className="desk-mark">First Meet</span><span className="desk-night">{night}</span></div>
      <div className="desk-count"><span className="desk-eyebrow">FIRST TOTALS TONIGHT</span><span className="num">{count.toLocaleString('en-US')}</span></div>
    </header>
  );
}
