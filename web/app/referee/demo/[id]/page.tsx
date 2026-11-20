import { notFound } from 'next/navigation';
import { Footer, Wordmark } from '@/components/chrome';
import { DemoStrip } from '@/components/demo-strip';
import { RefereeCall } from '@/components/referee-call';
import { db, hasDb } from '@/db';
import { hasR2, r2 } from '@/lib/r2';
import { closeCallView } from '@/lib/referee-view';
import { currentViewer } from '@/lib/roles';
import { BotBoard } from '@/components/bot-board';
import { LiveRefresh } from '@/components/live-refresh';
import { botSide, frameAlt } from '@/lib/referee/bot-view';
import { botOn } from '@/lib/referee/words';

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
  if (botOn()) return <BotPage c={c} />;

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

type View = NonNullable<Awaited<ReturnType<typeof closeCallView>>>;

/**
 * From item 88 (5.36, look 5.14d): the demo's close call went to the referee bot, and this shows
 * how it called it. The board first, so the lights land on screen; then the clip and what the judge
 * measured; then 6 of the frames it read. Nothing on this page sets lights.
 */
async function BotPage({ c }: { c: View }) {
  const a = c.attempt;
  const b = await botSide(db(), a.id);
  const side = b?.side ?? { state: 'deciding' as const };
  const store = hasR2() ? r2() : null;
  const frames = await Promise.all((b?.frames ?? []).map(async f => {
    let url: string | null = null;
    if (store) { try { url = await store.signedGet(f.key); } catch { url = null; } }
    return { ...f, url };
  }));
  const landscape = a.lift === 'bench' && c.division !== 'home';
  const dims = c.track ?? c.bar ?? null;
  // The frames' shape: the clip's, when the tracker or bar measured it. Otherwise (the judge didn't
  // run) a picture keeps its own shape, and only a missing one falls back to portrait.
  const ar = dims ? `${dims.w} / ${dims.h}` : landscape ? '16 / 9' : null;
  return (
    <>
      <DemoStrip />
      {side.state === 'deciding' && <LiveRefresh pollMs={5_000} />}
      <div className="wrap page">
        <main className="bot-page">
          <h1 className="eyebrow">THE REFEREE BOT</h1>
          <BotBoard attemptId={a.id} side={side} play looking="The referee bot is looking at this one." />
          <RefereeCall
            saveUrl="" askUrl={null} clipOnly
            lift={a.lift} division={c.division} videoUrl={c.videoUrl} track={c.track} bar={c.bar}
            judgedFrameMs={a.judgedFrameMs} repLights={a.repLights} repsDeclared={a.repsDeclared} measured={c.measured}
          />
          {frames.length > 0 && (
            <>
              <p className="small bot-frames-line">It reads still frames from your video, like these, and the judge&apos;s measurements. Each light is its own call.</p>
              <div className={`bot-frames${landscape ? ' landscape' : ''}`} style={ar ? { ['--ar' as string]: ar } : undefined}>
                {frames.map(f => f.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={f.n} src={f.url} alt={frameAlt(f)} loading="lazy" className={`bot-frame${f.judged ? ' judged' : ''}`} />
                ) : (
                  <span key={f.n} role="img" aria-label={frameAlt(f)} className={`bot-frame${f.judged ? ' judged' : ''}`} />
                ))}
              </div>
            </>
          )}
          {/* a full page load: the client router's platform can be from before the lift */}
          <a className="btn bot-back" href={DEMO_PLATFORM}>Back to the platform</a>
        </main>
      </div>
    </>
  );
}
