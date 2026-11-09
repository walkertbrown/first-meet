import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters, meets } from '@/db/schema';
import { DemoStrip } from '@/components/demo-strip';
import { NineRow, Platform } from '@/components/platform';
import { liftWord } from '@/lib/stage/meet-words';
import { OpensIn } from '@/components/opens-in';
import { currentViewer } from '@/lib/roles';
import { platformView } from '@/lib/platform-view';
import { PLAN_SWITCHES } from '@/lib/plan-switches';
import { ensureRealMeets, nextBlockStarts } from '@/lib/next-block';
import '../try.css';
import '../platform.css';

// The platform (plan 5.24–5.27): before the window, during it (the nine, one attempt at a time,
// each declared on the sheet), after all nine (5.28), and closed. The demo meet is always open.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'The platform', robots: { index: false } };

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  if (!hasDb()) redirect('/demo');
  const v = await currentViewer(db());
  if (!v) redirect('/demo');
  const [l] = await db().select().from(lifters).where(eq(lifters.id, v.id));
  if (!l?.meetId) redirect(v.isDemo ? '/demo' : '/');
  const [m] = await db().select().from(meets).where(eq(meets.id, l.meetId));
  if (!m) redirect('/');
  const view = await platformView(db(), l, m);
  // 5.36: "Start the demo meet" lands here with the welcome sheet first
  const welcome = l.isDemo && (await searchParams).welcome === '1' && l.cornerToken ? `/corner/${l.cornerToken}` : null;
  const strip = l.isDemo ? <DemoStrip /> : null;

  if (view.kind === 'done') {
    // her nine with their lights ("See my lifts", item 75); the total is one tap away
    const division = l.division;
    return (
      <>{strip}
        <div className="try-page meet-page"><main className="try-col meet-col">
          <div className="platform-top">
            <span className="eyebrow">{`${view.meetName} · Your nine attempts`}</span>
            <NineRow row={view.row} division={division} />
          </div>
          <ul className="nine-list">
            {view.nine.map(a => (
              <li key={a.id}>
                <Link href={`/platform/attempt/${a.id}`}>
                  <span className="nine-what body">{`${liftWord(a.lift, division)} ${a.number} · ${division === 'home' ? `${a.reps} reps at ${a.weight} ${l.units}` : `${a.weight} ${l.units}`}`}</span>
                  {a.call === 'close' ? <span className="small">Waiting</span>
                    : <span className="lamps-mini" role="img" aria-label={a.call === 'white' ? 'Good lift' : 'No lift'}>{a.lights.map((x, i) => <i key={i} className={`mini-lamp ${x}`} />)}</span>}
                </Link>
              </li>
            ))}
          </ul>
          <div className="try-actions"><Link className="btn" href="/platform/total">See your total</Link></div>
        </main></div>
      </>
    );
  }

  if (view.kind === 'before') {
    return (
      <>{strip}
        <div className="try-page meet-page"><main className="try-col meet-col platform-msg">
          <OpensIn at={view.opensAt} />
        </main></div>
      </>
    );
  }
  if (view.kind === 'closed') {
    const starts = await nextBlockDate();
    return (
      <>{strip}
        <div className="try-page meet-page"><main className="try-col meet-col platform-msg">
          <h1 className="page-title">The platform has closed</h1>
          <p className="body-l">{`You didn't lift this time. Your training still counts, and the next block starts ${starts}.`}</p>
          <div className="try-actions"><Link className="btn" href="/join">See the next block</Link></div>
        </main></div>
      </>
    );
  }
  return (
    <>{strip}
      <Platform
        meetName={view.meetName} closesAt={view.closesAt} row={view.row} current={view.current} because={view.because}
        notJudged={view.notJudged} demo={view.demo} welcomeCorner={welcome} voicePack={process.env.VOICE_PACK || 'team'}
        lifter={{ cardName: l.cardName, ageGroup: l.ageGroup, division: l.division, units: l.units }}
      />
    </>
  );
}

/** The next block's start (5.24). The 1:12 AM plan gives no date ("soon"); item 76 reads it from the next real meet. */
async function nextBlockDate() {
  if (!PLAN_SWITCHES.item76) return 'soon';
  await ensureRealMeets(db());
  return nextBlockStarts(db());
}
