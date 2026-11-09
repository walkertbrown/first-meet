import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters, meets } from '@/db/schema';
import { DemoStrip } from '@/components/demo-strip';
import { Platform } from '@/components/platform';
import { OpensIn } from '@/components/opens-in';
import { currentViewer } from '@/lib/roles';
import { platformView } from '@/lib/platform-view';
import '../try.css';
import '../platform.css';

// The platform (plan 5.24–5.27): before the window, during it (the nine, one attempt at a time,
// each declared on the sheet), after all nine (5.28), and closed. The demo meet is always open.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'The platform', robots: { index: false } };

export default async function PlatformPage() {
  if (!hasDb()) redirect('/demo');
  const v = await currentViewer(db());
  if (!v) redirect('/demo');
  const [l] = await db().select().from(lifters).where(eq(lifters.id, v.id));
  if (!l?.meetId) redirect(v.isDemo ? '/demo' : '/');
  const [m] = await db().select().from(meets).where(eq(meets.id, l.meetId));
  if (!m) redirect('/');
  const view = await platformView(db(), l, m);
  if (view.kind === 'done') redirect('/platform/total');
  const strip = l.isDemo ? <DemoStrip /> : null;

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
    return (
      <>{strip}
        <div className="try-page meet-page"><main className="try-col meet-col platform-msg">
          <h1 className="page-title">The platform has closed</h1>
          <p className="body-l">{`You didn't lift this time. Your training still counts, and the next block starts ${nextBlockDate()}.`}</p>
          <div className="try-actions"><Link className="btn" href="/join">See the next block</Link></div>
        </main></div>
      </>
    );
  }
  return (
    <>{strip}
      <Platform
        meetName={view.meetName} closesAt={view.closesAt} row={view.row} current={view.current} because={view.because}
        notJudged={view.notJudged} demo={view.demo} voicePack={process.env.VOICE_PACK || 'team'}
        lifter={{ cardName: l.cardName, ageGroup: l.ageGroup, division: l.division, units: l.units }}
      />
    </>
  );
}

/** The next block's start (5.24, 5.32), from NEXT_BLOCK_STARTS (an ISO date); the plan doesn't give it yet. */
function nextBlockDate() {
  const d = process.env.NEXT_BLOCK_STARTS ? new Date(process.env.NEXT_BLOCK_STARTS) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' }) : 'soon';
}
