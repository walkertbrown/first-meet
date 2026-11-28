import '../meet.css';
import { Footer, Wordmark } from '@/components/chrome';
import { StatusAge } from '@/components/status-age';
import { db, hasDb } from '@/db';
import { DB_DOWN, platformStatus, storesUp } from '@/lib/status';

// /status (plan 5.7): public. Refreshes every 15 s.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Platform status' };

export default async function Page() {
  const up = await storesUp();
  const s = hasDb() ? await platformStatus(db(), up).catch(() => DB_DOWN) : DB_DOWN;
  return (
    <div className="wrap page status-page">
      <header className="topbar"><Wordmark /></header>
      <main>
        <h1 className="page-title">Platform status</h1>
        {s.incident && (
          <div className="card status-incident" role="status">
            {s.incident.title && <h2 className="sheet-title">{s.incident.title}</h2>}
            {s.incident.sentence && <p className="body">{s.incident.sentence}</p>}
          </div>
        )}
        <ul className="status-rows">
          {s.rows.map(r => (
            <li key={r.label}>
              <i className={`mini-lamp${r.ok ? ' white' : ''}`} aria-hidden="true" />
              <span className="status-label">{r.label}</span>
              <span className="body status-value">{r.value}</span>
            </li>
          ))}
        </ul>
        <StatusAge at={new Date().toISOString()} />
      </main>
      <Footer />
    </div>
  );
}
