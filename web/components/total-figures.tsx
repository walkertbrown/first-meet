'use client';
// "You totaled"'s numbers (plan 5.28, 3.8; look 4 "A total that changes after its reveal"; look 9
// step 7): the total counts up the first time she sees it (520 ms, cubic ease-out). One reveal per
// meet: if a late clip raises it while she's on the page, the late lift's number drops in (560 ms,
// --ease-lamp) and the total counts up from the old number to the new one; if she was away, she
// finds the new number settled. Either way the Small line names the lift that landed late. Nothing
// counts down. Motion off: the number and the line at once. What she has seen stays on her phone.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatTotal, type TotalLift } from '@/lib/total-view';

export type Seen = { v: number | null; late?: string | null };
export const seenKey = (k: string) => `fm-total-seen:${k}`;

export function readSeen(k: string): Seen | undefined {
  try {
    const raw = localStorage.getItem(seenKey(k));
    return raw ? JSON.parse(raw) as Seen : undefined;
  } catch { return undefined; }
}
export function writeSeen(k: string, s: Seen) {
  try { localStorage.setItem(seenKey(k), JSON.stringify(s)); } catch { /* private window: it simply plays again */ }
}

/**
 * How the total shows when the page opens, from what she saw last (pure, for the tests):
 * - never seen a total (nothing, or the bomb-out page): the reveal, from 0;
 * - the same total: settled, keeping its line if it had one;
 * - a higher total (a late clip landed while she was away): settled, with the line;
 * - a lower one (a spot check's red): settled, no line.
 */
export function openingShow(seen: Seen | undefined, value: number, late: string | null): { from: number | null; line: string | null } {
  if (!seen || seen.v === null) return { from: 0, line: seen?.v === null ? late : null };
  if (seen.v === value) return { from: null, line: seen.late ?? null };
  if (seen.v < value) return { from: null, line: late };
  return { from: null, line: null };
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** The bomb-out page tells the total page she has seen no total yet (so a late good lift reveals once). */
export function SeenBombed({ storeKey }: { storeKey: string }) {
  useEffect(() => { if (!readSeen(storeKey)) writeSeen(storeKey, { v: null }); }, [storeKey]);
  return null;
}

export function TotalFigures(p: {
  storeKey: string; value: number; valueText: string;
  unitLine: string; nineForNine: boolean; lifts: TotalLift[]; title: string; late: { lift: string; line: string } | null;
}) {
  const late = p.late?.line ?? null;
  const [shown, setShown] = useState<number | null>(null); // null: the real number
  const [line, setLine] = useState<string | null>(null);
  const [drop, setDrop] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const last = useRef<number | null>(null);
  const raf = useRef(0);

  const count = (from: number, to: number) => {
    cancelAnimationFrame(raf.current);
    if (reduced() || from >= to) { setShown(null); return; }
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 520);
      if (k >= 1) { setShown(null); return; }
      setShown(from + (to - from) * easeOut(k));
      raf.current = requestAnimationFrame(tick);
    };
    setShown(from);
    raf.current = requestAnimationFrame(tick);
  };

  // opening: before the first paint after hydration, so the reveal never flashes the final number
  useLayoutEffect(() => {
    const o = openingShow(readSeen(p.storeKey), p.value, late);
    setLine(o.line);
    if (o.from !== null) count(o.from, p.value);
    setPending(false);
    last.current = p.value;
    writeSeen(p.storeKey, { v: p.value, late: o.line });
    return () => cancelAnimationFrame(raf.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // a late clip landing while she's here (the page re-reads on its live stream)
  useEffect(() => {
    const was = last.current;
    if (was === null || was === p.value) return;
    last.current = p.value;
    const up = p.value > was;
    setLine(up ? late : null);
    writeSeen(p.storeKey, { v: p.value, late: up ? late : null });
    if (up) {
      if (!reduced()) setDrop(p.late?.lift ?? null);
      count(was, p.value);
    } else setShown(null);
  }, [p.value]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = shown === null ? p.valueText : formatTotal(Math.round(shown));
  return (
    <>
      <div className="total-num" style={{ ['--chars' as string]: String(p.valueText.length) }}>
        <span className="meet-total num" data-pending={pending || undefined} aria-label={p.valueText}>{text}</span>
        <noscript><style>{'.meet-total[data-pending]{opacity:1}'}</style></noscript>
      </div>
      {line && <p className="small total-late">{line}</p>}
      <div className="total-unit">
        <span className="eyebrow">{p.unitLine}</span>
        {p.nineForNine && <span className="nine-for-nine">9 FOR 9</span>}
      </div>
      <h1 className="page-title">{p.title}</h1>
      <TotalLiftsList lifts={p.lifts} drop={drop} onDropped={() => setDrop(null)} />
    </>
  );
}

function TotalLiftsList({ lifts, drop, onDropped }: { lifts: TotalLift[]; drop: string | null; onDropped: () => void }) {
  return (
    <dl className="total-lifts">
      {lifts.map(x => {
        const cls = drop === x.lift ? ' lift-drop' : '';
        return (
          <div key={x.lift}>
            <dt className="eyebrow">{x.label}</dt>
            {x.written
              ? <><dd className={`number-s num${cls}`} onAnimationEnd={onDropped}>{x.written}</dd><dd className="small">{x.value}</dd></>
              : <dd className={`number-s num${cls}`} onAnimationEnd={onDropped}>{x.value}</dd>}
          </div>
        );
      })}
    </dl>
  );
}
