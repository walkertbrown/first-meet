import '../referee.css';
import { AutoRefresh } from '@/components/auto-refresh';
import { Footer, Wordmark } from '@/components/chrome';
import { db } from '@/db';
import { budgetsFromEnv } from '@/lib/dispatcher';
import { requireRole } from '@/lib/guard';
import { commitsDiffer, opsNumbers, opsSections } from '@/lib/ops';
import { botOps } from '@/lib/referee/bot';
import { botRows, notRunningLine, TEST_ANSWER_CHOICES } from '@/lib/referee/ops-words';

// /ops (plan 2.4, 5.39): how the judge is running. Admins only (an email in ADMIN_EMAILS).
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ops', robots: { index: false } };

const at = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });

export default async function Page() {
  await requireRole('admin');
  const budgets = budgetsFromEnv();
  const n = await opsNumbers(db(), budgets);
  const bot = await botOps(db());
  const sections = [...opsSections(n, budgets), { eyebrow: 'REFEREE BOT', rows: botRows(bot) }];
  const botLine = notRunningLine(bot);
  return (
    <div className="wrap page desk">
      <AutoRefresh everyMs={10_000} />
      <header className="topbar"><Wordmark /></header>
      <main>
        <h1 className="page-title">Ops</h1>
        {commitsDiffer(n.commits) && <p className="ops-warn strong" role="alert">Judge and web are on different commits</p>}
        {botLine && <p className="ops-warn strong" role="alert">{botLine}</p>}
        <div className="ops-grid">
          {sections.map(s => (
            <section key={s.eyebrow} className="ops-section" aria-labelledby={`ops-${s.eyebrow.replace(/\W+/g, '-')}`}>
              <h2 className="eyebrow" id={`ops-${s.eyebrow.replace(/\W+/g, '-')}`}>{s.eyebrow}</h2>
              <dl>
                {s.rows.map(r => (
                  <div key={r.label} className="ops-row">
                    <dt>{r.label}</dt>
                    <dd className={r.over ? 'num ops-over' : 'num'}>{r.value}{r.over ? ' over' : null}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {bot.testAnswersAllowed && (
            <section className="ops-section" aria-labelledby="ops-test-answers">
              <h2 className="eyebrow" id="ops-test-answers">STAGING</h2>
              <form method="post" action="/api/ops/referee-test-answers" className="ops-choice">
                <fieldset>
                  <legend>Referee bot test answers</legend>
                  {TEST_ANSWER_CHOICES.map(c => (
                    <label key={c.value} className="ops-radio">
                      <input type="radio" name="answers" value={c.value} defaultChecked={(bot.testAnswers ?? 'real') === c.value} />
                      {c.label}
                    </label>
                  ))}
                </fieldset>
                <p className="small">For the next job only. Each fakes only what comes back from Anthropic.</p>
                <button className="btn ghost" type="submit">Use for the next job</button>
              </form>
            </section>
          )}
          <section className="ops-section ops-errors" aria-labelledby="ops-ERRORS">
            <h2 className="eyebrow" id="ops-ERRORS">ERRORS</h2>
            {n.clipsFailed > 0 && <p className="ops-row"><span>Clips that failed · <span className="num">{n.clipsFailed}</span></span></p>}
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
