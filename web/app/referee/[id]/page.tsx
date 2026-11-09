import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Footer, Wordmark } from '@/components/chrome';
import { RefereeCall } from '@/components/referee-call';
import { db } from '@/db';
import { requireRole } from '@/lib/guard';
import { hasR2, r2 } from '@/lib/r2';
import { nextCloseCall } from '@/lib/referee';
import { closeCallView } from '@/lib/referee-view';

// One close call (plan 5.33, look 5.13). Referees only; the lifter's name is never shown.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Close call', robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const v = await requireRole('referee');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const c = await closeCallView(db(), hasR2() ? r2() : null, id);
  if (!c || c.meetKind === 'demo') notFound();
  const a = c.attempt;
  const askedByMe = c.secondOpinion?.refereeId === v.id;

  if (a.status !== 'close_call' || askedByMe) {
    const next = await nextCloseCall(db(), v.id);
    return (
      <Desk>
        <h1 className="page-title">{c.title}</h1>
        <div className="ref-done" role="status">
          <p className="sheet-title">{askedByMe ? 'Sent to another referee. Next close call?' : 'Another referee has already decided this one. Next close call?'}</p>
          <Link className="btn" href={next ? `/referee/${next}` : '/referee'}>Next</Link>
        </div>
      </Desk>
    );
  }

  return (
    <Desk>
      <p className="small"><Link href="/referee">Close calls</Link></p>
      <h1 className="page-title">{c.title}</h1>
      <p className="small">{[c.ageGroup ? `Age group ${c.ageGroup}` : null, c.why].filter(Boolean).join(' · ')}</p>
      {c.secondOpinion && (
        <div className="ref-second">
          <p className="small">Another referee asked for a second look.</p>
          {c.secondOpinion.note && <p className="small">“{c.secondOpinion.note}”</p>}
        </div>
      )}
      <RefereeCall
        saveUrl={`/api/referee/${a.id}`}
        askUrl={c.secondOpinion ? null : `/api/referee/${a.id}`}
        lift={a.lift}
        division={c.division}
        videoUrl={c.videoUrl}
        track={c.track}
        judgedFrameMs={a.judgedFrameMs}
        repLights={a.repLights}
        repsDeclared={a.repsDeclared}
        measured={c.measured}
      />
    </Desk>
  );
}

function Desk({ children }: { children: React.ReactNode }) {
  return (
    <div className="wrap page desk">
      <header className="topbar"><Wordmark /></header>
      <main className="ref-main">{children}</main>
      <Footer />
    </div>
  );
}
