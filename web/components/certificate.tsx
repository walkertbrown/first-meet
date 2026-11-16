// The certificate (look 9): ink on chalk, US Letter portrait. Lamps as rings with "white light" under each,
// the total at 160 pt and the name at 40 pt, the attempt sheet at the foot, and the honest line at 9 pt.
import { CERT, type Certificate as Cert } from '@/lib/card/certificate';
import { CARD_FOOTER, HONEST_LINE } from '@/lib/card/card-view';

export function Certificate({ c }: { c: Cert }) {
  return (
    <article className="cert" aria-label={`${c.name}'s certificate`}>
      <header className="cert-head">
        <span className="cert-mark">First Meet</span>
        <span className="cert-season">{c.season}</span>
      </header>
      <ul className="cert-lamps" aria-label="Three white lights">
        {[0, 1, 2].map(i => <li key={i}><i aria-hidden="true" /><span>{CERT.lampWord}</span></li>)}
      </ul>
      <h1 className="cert-name">{c.name}</h1>
      {c.meta && <p className="cert-meta">{c.meta}</p>}
      <p className="cert-total"><span className="num">{c.total}</span></p>
      <p className="cert-unit">{c.unitLine}{c.nineForNine && <span className="cert-tag">9 FOR 9</span>}</p>
      <ul className="cert-lifts">
        {c.lifts.map(l => <li key={l.lift}><span className="cert-label">{l.label}</span><span className="num">{l.written ?? l.value}</span></li>)}
      </ul>
      <blockquote className="cert-quote"><p>{CERT.quote}</p><cite>{CERT.quoteBy}</cite></blockquote>
      <table className="cert-sheet">
        <thead><tr>{CERT.heads.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>
          {c.sheet.map(r => (
            <tr key={r.lift}>
              <th scope="row">{r.lift}</th>
              {r.cells.map((x, i) => <td key={i}>{x ? <><span className="num">{x.weight}</span> <span className="cert-result">{x.result}</span></> : '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <footer className="cert-foot">
        <p>{CARD_FOOTER}</p>
        <p className="cert-honest">{HONEST_LINE}</p>
      </footer>
    </article>
  );
}
