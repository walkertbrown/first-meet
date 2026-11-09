import '../referee.css';
import { AutoRefresh } from '@/components/auto-refresh';
import { Footer, Wordmark } from '@/components/chrome';
import { db } from '@/db';
import { budgetsFromEnv } from '@/lib/dispatcher';
import { requireRole } from '@/lib/guard';
import { commitsDiffer, opsNumbers, opsSections } from '@/lib/ops';

// /ops (plan 2.4, 5.39): how the judge is running. Admins only (an email in ADMIN_EMAILS).
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ops', robots: { index: false } };

const at = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });

export default async function Page() {
  await requireRole('admin');
  const budgets = budgetsFromEnv();
  const n = await opsNumbers(db(), budgets);
  const sections = opsSections(n, budgets);
  return (
    <div className="wrap page desk">
      <AutoRefresh everyMs={10_000} />
      <header className="topbar"><Wordmark /></header>
      <main>
        <h1 className="page-title">Ops</h1>
        {commitsDiffer(n.commits) && <p className="ops-warn strong" role="alert">Judge and web are on different commits</p>}
        <div className="ops-grid">
          {sections.map(s => (
            <section key={s.eyebrow} className="ops-section" aria-labelledby={`ops-${s.eyebrow}`}>
              <h2 className="eyebrow" id={`ops-${s.eyebrow}`}>{s.eyebrow}</h2>
              <dl>
                {s.rows.map(r => (
                  <div key={r.label} className="ops-row">
                    <dt>{r.label}</dt>
                    <dd className="num">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <section className="ops-section ops-errors" aria-labelledby="ops-ERRORS">
            <h2 className="eyebrow" id="ops-ERRORS">ERRORS</h2>
            {n.errors.length === 0 ? <p className="small">No errors yet.</p> : (
              <ol>
                {n.errors.map((e, i) => (
                  <li key={i} className="ops-row">
                    <span className="small">{at(e.at)} ET</span>
                    <span>{e.text}{e.attemptId ? <span className="small"> · {e.attemptId.slice(0, 8)}</span> : null}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
