import Link from 'next/link';
import { Footer, Wordmark } from '@/components/chrome';
import { AutoRefresh } from '@/components/auto-refresh';
import { db } from '@/db';
import { requireRole } from '@/lib/guard';
import { hasR2, r2 } from '@/lib/r2';
import { closeCallQueue } from '@/lib/referee';
import { liftName, minutes, queueLine, weightText, whyText } from '@/lib/referee-view';

// The close-call queue (plan 5.33, look 5.13), oldest first. Referees only.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Close calls', robots: { index: false } };

export default async function Page() {
  const v = await requireRole('referee');
  const rows = await closeCallQueue(db(), v.id);
  const thumbs = await Promise.all(rows.map(async r => {
    if (!r.videoKey || !hasR2()) return null;
    try { return `${await r2().signedGet(r.videoKey)}#t=${((r.judgedFrameMs ?? 0) / 1000).toFixed(2)}`; } catch { return null; }
  }));
  const line = queueLine(rows);
  return (
    <div className="wrap page desk">
      <AutoRefresh />
      <header className="topbar"><Wordmark /></header>
      <main>
        <h1 className="page-title">Close calls</h1>
        {line ? <p className="body-l desk-line">{line}</p> : (
          <div className="desk-empty">
            <p className="body-l">No close calls. Nice.</p>
            <p className="small">New ones appear here as they come.</p>
          </div>
        )}
        {rows.length > 0 && (
          <table className="board ref-queue">
            <thead>
              <tr><th scope="col">Clip</th><th scope="col">Lift</th><th scope="col">Why it was sent</th><th scope="col" className="n">Waiting</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.attemptId}>
                  <td>
                    <Link href={`/referee/${r.attemptId}`} className="ref-thumb" aria-label={`Open ${liftName(r.lift, r.division)} ${r.number}`}>
                      {thumbs[i] ? <video src={thumbs[i]!} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" /> : null}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/referee/${r.attemptId}`}>{liftName(r.lift, r.division)} {r.number}</Link>
                    <span className="ref-sub">{weightText(r.weight, r.units, r.repsDeclared)}</span>
                  </td>
                  <td>
                    {whyText(r.reason)}
                    {r.secondOpinion && <span className="ref-sub">Second opinion</span>}
                  </td>
                  <td className={`n${r.waitingS > 600 ? ' strong' : ''}`}>{minutes(r.waitingS)} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
      <Footer />
    </div>
  );
}
