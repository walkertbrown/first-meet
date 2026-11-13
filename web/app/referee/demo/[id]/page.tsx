import { notFound } from 'next/navigation';
import { Footer, Wordmark } from '@/components/chrome';
import { DemoStrip } from '@/components/demo-strip';
import { RefereeCall } from '@/components/referee-call';
import { db, hasDb } from '@/db';
import { hasR2, r2 } from '@/lib/r2';
import { closeCallView } from '@/lib/referee-view';
import { currentViewer } from '@/lib/roles';

// The demo referee (plan 5.36, look 5.14a): exactly the referee's close call, with the demo
// strip on top, deciding the demo lifter's own close call. No sign-in beyond the demo session.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Close call', robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Where the demo lifter lifts (the demo's platform). */
const DEMO_PLATFORM = '/platform';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id) || !hasDb()) notFound();
  const v = await currentViewer(db());
  if (!v || !v.isDemo || v.session.kind !== 'demo') notFound();
  const c = await closeCallView(db(), hasR2() ? r2() : null, id);
  if (!c || c.meetKind !== 'demo' || c.lifterId !== v.id) notFound();
  const a = c.attempt;

  return (
    <>
      <DemoStrip />
      <div className="wrap page desk">
        <header className="topbar"><Wordmark /></header>
        <main className="ref-main">
          <h1 className="page-title">{c.title}</h1>
          <p className="small">{[c.ageGroup ? `Age group ${c.ageGroup}` : null, c.why].filter(Boolean).join(' · ')}</p>
          {a.status === 'close_call' ? (
            <RefereeCall
              saveUrl={`/api/referee/demo/${a.id}`}
              askUrl={null}
              lift={a.lift}
              division={c.division}
              videoUrl={c.videoUrl}
              track={c.track}
              bar={c.bar}
              judgedFrameMs={a.judgedFrameMs}
              repLights={a.repLights}
              repsDeclared={a.repsDeclared}
              measured={c.measured}
              demoDoneHref={DEMO_PLATFORM}
            />
          ) : (
            <div className="ref-done" role="status">
              <p className="sheet-title">Saved. Your lights are on the platform.</p>
              {/* a full page load: the client router's platform can be from before the lift */}
              <a className="btn" href={DEMO_PLATFORM}>Back to the platform</a>
            </div>
          )}
        </main>
        <Footer />
      </div>
    </>
  );
}
