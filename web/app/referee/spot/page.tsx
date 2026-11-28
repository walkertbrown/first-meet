import { Footer, Wordmark } from '@/components/chrome';
import { AutoRefresh } from '@/components/auto-refresh';
import { SpotLifter } from '@/components/spot-desk';
import { db } from '@/db';
import { requireRole } from '@/lib/guard';
import { spotDesk, type SpotDeskRow } from '@/lib/referee/spot-desk';
import '../../platform.css';

// Spot checks (plan 5.33, look 5.13a): the top 3 in each group, all nine clips, the bot's line and a
// person's Checked or Problem. Referees only; read only once the board is final.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Spot checks', robots: { index: false } };

export default async function Page() {
  await requireRole('referee');
  const d = await spotDesk(db());
  const groups = new Map<string, SpotDeskRow[]>();
  for (const r of d?.rows ?? []) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  return (
    <div className="wrap page desk">
      {d && !d.final && <AutoRefresh />}
      <header className="topbar"><Wordmark /></header>
      <main>
        <h1 className="page-title">Spot checks</h1>
        <p className="body num spot-count">{d ? `${d.toCheck} to check · ${d.checked} checked` : '0 to check · 0 checked'}</p>
        <p className="body">Check the weight is visible and it&apos;s the same lifter in every clip.</p>
        {[...groups].map(([g, rows]) => (
          <section key={g} className="spot-group" aria-label={g}>
            <span className="eyebrow">{g}</span>
            {rows.map(r => <SpotLifter key={r.lifterId} row={r} readOnly={d!.final} />)}
          </section>
        ))}
      </main>
      <Footer />
    </div>
  );
}
