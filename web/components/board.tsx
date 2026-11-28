'use client';
// The board (plan 5.6, look 5.11): a table in Board row type. Desktop: place, lifter, age, then each
// lift with its three mini lamps, then the total. Phone: place, lifter, age and total; tapping a row
// opens its three lifts. Her own row has the 4 px --ink bar and the --surface fill. A row that
// arrives slides in over 260 ms and its lamps light 330 ms apart.
import { Fragment, useEffect, useRef, useState } from 'react';
import type { Lift } from '@/db/schema';
import type { BoardRow, Division, LampCall } from '@/lib/board';

export const BOARD_EMPTY = 'No totals yet. The platform opens Friday at 6 am Eastern.';
const LIFTS: Lift[] = ['squat', 'bench', 'deadlift'];

export const liftHeading = (lift: Lift, d: Division) => (lift === 'squat' ? 'Squat' : lift === 'bench' ? (d === 'home' ? 'Press' : 'Bench') : 'Deadlift');

export function MiniLamps({ lamps, delayFrom }: { lamps: LampCall[]; delayFrom?: number }) {
  return (
    <span className="mini-lamps" aria-hidden="true">
      {lamps.map((s, i) => (
        <i key={i} className={`mini-lamp${s !== 'off' ? ' ' + s : ''}${delayFrom != null && s !== 'off' ? ' lights-in' : ''}`}
          style={delayFrom != null ? { animationDelay: `${(delayFrom + i) * 330}ms` } : undefined} />
      ))}
    </span>
  );
}

type Shown = BoardRow & { place: number };

/** Rows that weren't there on the last draw (look 5.11's arrival); none on the first draw. */
function useArrivals(rows: Shown[]) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const ids = rows.map(r => r.id).join(',');
  useEffect(() => {
    const now = new Set(ids ? ids.split(',') : []);
    if (seen.current) setFresh(new Set([...now].filter(id => !seen.current!.has(id))));
    seen.current = now;
  }, [ids]);
  return fresh;
}

export function Board({ rows, division, meId, empty = BOARD_EMPTY, caption }: {
  rows: Shown[]; division: Division; meId?: string | null; empty?: string; caption?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const fresh = useArrivals(rows);
  if (!rows.length) return <p className="body board-empty">{empty}</p>;
  const total = division === 'home' ? 'Score' : 'Total';
  return (
    <table className="board">
      {caption && <caption className="sr">{caption}</caption>}
      <thead>
        <tr>
          <th scope="col" className="b-place">Place</th>
          <th scope="col" className="b-name">Lifter</th>
          <th scope="col" className="b-age">Age</th>
          {LIFTS.map(l => (
            <Fragment key={l}>
              <th scope="col" className="b-lift">{liftHeading(l, division)}</th>
              <th scope="col" className="b-lamps"><span className="sr">{`${liftHeading(l, division)} lights`}</span></th>
            </Fragment>
          ))}
          <th scope="col" className="b-total">{total}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const isOpen = open === r.id, arrived = fresh.has(r.id);
          return (
            <Fragment key={r.id}>
              <tr className={`${r.id === meId ? 'me' : ''}${arrived ? ' arrive' : ''}`.trim() || undefined}>
                <td className="b-place num">{r.place}</td>
                <td className="b-name">
                  <button type="button" className="b-open" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>{r.name}</button>
                </td>
                <td className="b-age">{r.ageGroup}</td>
                {LIFTS.map((l, k) => (
                  <Fragment key={l}>
                    <td className="b-lift num">{r.lifts[l].text}</td>
                    <td className="b-lamps"><MiniLamps lamps={r.lifts[l].lamps} delayFrom={arrived ? k * 3 : undefined} /></td>
                  </Fragment>
                ))}
                <td className="b-total num">{r.totalText}</td>
              </tr>
              {isOpen && (
                <tr className={`b-more${r.id === meId ? ' me' : ''}`}>
                  <td colSpan={11}>
                    <dl>
                      {LIFTS.map(l => (
                        <div key={l}><dt>{liftHeading(l, division)}</dt><dd><span className="num">{r.lifts[l].text}</span><MiniLamps lamps={r.lifts[l].lamps} /></dd></div>
                      ))}
                    </dl>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
