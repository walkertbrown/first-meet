import '../../platform.css';
import '../../meet.css';
import type { Metadata } from 'next';
import { and, eq, inArray } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { Footer, Wordmark } from '@/components/chrome';
import { LiveBoard } from '@/components/live-night';
import { db, hasDb } from '@/db';
import { meets } from '@/db/schema';
import { awards, boardRows, placeOf, rowCard, type BoardLifter } from '@/lib/board';
import { meetLifters } from '@/lib/host-data';
import { meetEyebrow } from '@/lib/live-page';
import { resultsLines } from '@/lib/referee/spot';
import { currentViewer } from '@/lib/roles';

// Results (plan 5.31), public, once meet control makes the board final: her row card when signed in,
// the awards, and the final board with each top-3 lifter's spot-check line (item 105).
export const dynamic = 'force-dynamic';

async function finalMeet(slug: string) {
  if (!hasDb()) return null;
  const [m] = await db().select().from(meets).where(and(eq(meets.slug, slug), inArray(meets.kind, ['real', 'test'])));
  return m?.status === 'final' ? m : null;
}

export async function generateMetadata({ params }: { params: Promise<{ meet: string }> }): Promise<Metadata> {
  const m = await finalMeet((await params).meet);
  return { title: m ? `${m.name} results` : 'Results' };
}

export default async function Page({ params }: { params: Promise<{ meet: string }> }) {
  const m = await finalMeet((await params).meet);
  if (!m) notFound();
  const [viewer, list] = await Promise.all([currentViewer(db()), meetLifters(db(), m.id)]);
  const board: BoardLifter[] = list.map(l => ({ id: l.id, name: l.name, ageGroup: l.ageGroup, age: l.age, division: l.division, units: l.units, attempts: l.attempts }));
  const me = viewer ? board.find(l => l.id === viewer.id) ?? null : null;
  const mine = me ? placeOf(boardRows(board, me.division), me.id) : null;
  const won = awards(board);
  const notes = await resultsLines(db(), m.id, board);
  return (
    <div className="wrap page results-page">
      <header className="topbar"><Wordmark /></header>
      <main>
        <span className="eyebrow">{meetEyebrow(m.name)}</span>
        <h1 className="page-title">{m.name} · final results</h1>
        {mine && me && (
          <div className="card live-me">
            <p className="body-l">{rowCard(mine.place, mine.of, me.division, mine.ageGroup)}</p>
          </div>
        )}
        {won.length > 0 && (
          <section className="live-awards" aria-labelledby="results-awards-h">
            <h2 className="eyebrow" id="results-awards-h">AWARDS</h2>
            <ul className="award-cards">
              {won.map(a => (
                <li key={`${a.kind}-${a.division}-${a.ageGroup}-${a.lifterId}`} className="card">
                  <span className="eyebrow">{a.title}</span>
                  <p className="body-l">{a.name}</p>
                  <p className="small">{a.division === 'home' ? 'Home' : 'Barbell'} · {a.ageGroup}</p>
                  <p className="body">{a.reason}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
        <LiveBoard lifters={board} meId={me?.id ?? null} start={me?.division ?? 'barbell'} notes={notes} empty="No totals in this meet." />
      </main>
      <Footer />
    </div>
  );
}
