import '../referee.css';
import Link from 'next/link';
import { notSameLifter } from '@/lib/referee/spot';
import { AutoRefresh } from '@/components/auto-refresh';
import { Footer, Wordmark } from '@/components/chrome';
import { db } from '@/db';
import { budgetsFromEnv } from '@/lib/dispatcher';
import { emailLimitLine } from '@/lib/email';
import { requireRole } from '@/lib/guard';
import { commitsDiffer, opsNumbers, opsSections } from '@/lib/ops';
import { botOps } from '@/lib/referee/bot';
import { statusMessage } from '@/lib/meet-control';
import { failedRemakes, remakeOn } from '@/lib/card/clip-remake';
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
  // The Playner, Nov 28: at the day's limit, say so, with the count not sent
  const mailLine = await emailLimitLine(db());
  // the status message is written on meet control (5.7, The Playner, Nov 28): /ops links to it
  const said = await statusMessage(db());
  // 3.4d step 8: a sure "not the same lifter" shows here for admins and does nothing automatic
  const notSame = await notSameLifter(db());
  // item 119 (held): a clip made again for her changed end card failed twice; she keeps the old one
  const oldTotals = remakeOn() ? await failedRemakes(db()) : [];
  const clipsFailed = n.clipsFailed + oldTotals.length;
  return (
    <div className="wrap page desk">
      <AutoRefresh everyMs={10_000} />
      <header className="topbar"><Wordmark /></header>
      <main>
        <h1 className="page-title">Ops</h1>
        {commitsDiffer(n.commits) && <p className="ops-warn strong" role="alert">Judge and web are on different commits</p>}
        {botLine && <p className="ops-warn strong" role="alert">{botLine}</p>}
        {mailLine && <p className="ops-warn strong" role="alert">{mailLine}</p>}
        <p className="small ops-status">
          {said && <>On /status: {said.title || said.sentence} · </>}
          <Link href="/host/control#c-status">Write the status message</Link>
        </p>
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
          {notSame.length > 0 && (
            <section className="ops-section" aria-labelledby="ops-spot">
              <h2 className="eyebrow" id="ops-spot">SPOT CHECKS</h2>
              {notSame.map(l => (
                <p key={l.id} className="ops-row"><span>Not the same lifter · {l.name}</span></p>
              ))}
              <p className="small"><Link href="/referee/spot">Open spot checks</Link></p>
            </section>
          )}
          <section className="ops-section ops-errors" aria-labelledby="ops-ERRORS">
            <h2 className="eyebrow" id="ops-ERRORS">ERRORS</h2>
            {clipsFailed > 0 && <p className="ops-row"><span>Clips that failed · <span className="num">{clipsFailed}</span></span></p>}
            {oldTotals.map(c => (
              <form key={c.attemptId} method="post" action="/api/ops/clip-remake" className="ops-row">
                <span>Old total on her clip · {c.name}</span>
                <input type="hidden" name="attempt" value={c.attemptId} />
                <button className="btn ghost" type="submit">Try again</button>
              </form>
            ))}
            <p className="ops-row"><span>Stuck bar tracks · <span className="num">{n.stuckTracks}</span></span></p>
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
