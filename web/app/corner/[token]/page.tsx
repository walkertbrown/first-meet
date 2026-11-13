import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { db, hasDb } from '@/db';
import { CornerLive, CornerNameForm, NAME_COOKIE } from '@/components/corner';
import { LightsDown } from '@/components/lights-down';
import { CLOSED_BODY, cornerView, juneView, type CornerView } from '@/lib/corner-view';
import { cleanCornerName } from '@/lib/cheer-words';
import { hasR2, r2 } from '@/lib/r2';
import { DEMO_LINE } from '@/lib/total-view';
import '../../try.css';
import '../../platform.css';
import '../../corner.css';

// Her corner page (plan 5.4): public, no account, by her corner token. Before meet weekend it
// takes a first name; on meet weekend it shows her nine live, with "Cheer" on each sent attempt.
// /corner/demo is June Okafor's (5.36).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Her corner', robots: { index: false, follow: false } };

const sign = async (key: string) => {
  if (!hasR2()) return null;
  try { return await r2().signedGet(key); } catch { return null; }
};

export default async function CornerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const now = new Date();
  let view: CornerView | null;
  if (token === 'demo') view = juneView(now);
  else if (!hasDb()) notFound();
  else view = await cornerView(db(), token, now, sign);
  if (!view) notFound();
  const saved = cleanCornerName(decodeURIComponent((await cookies()).get(NAME_COOKIE)?.value ?? ''));

  if (view.kind === 'gone') {
    return (
      <div className="try-page meet-page"><main className="try-col corner-col">
        <h1 className="page-title">This corner page has closed.</h1>
        <div className="try-actions"><Link className="btn ghost" href="/">What is First Meet?</Link></div>
      </main></div>
    );
  }

  // the before and closed states keep the live page's top, as gone does (LookieBot 4)
  if (view.kind === 'before') {
    return (
      <div className="try-page meet-page"><main className="try-col corner-col">
        <span className="eyebrow">{`First Meet · ${view.meetName}`}</span>
        <h1 className="page-title">{view.title}</h1>
        <p className="body-l">You&apos;re in her corner. On meet weekend, her lifts and their referee lights show up here as they&apos;re judged, and you can cheer each one.</p>
        <CornerNameForm saved={saved} />
        <p className="small corner-note">No account needed. Bookmark this page.</p>
        <div className="try-actions"><Link className="btn ghost" href="/">What is First Meet?</Link></div>
      </main></div>
    );
  }

  if (view.kind === 'closed') {
    // not LIVE: the meet has closed. No row, no list, no "Cheer" (5.4, item 90)
    return (
      <div className="try-page meet-page"><main className="try-col corner-col">
        <span className="eyebrow">{`First Meet · ${view.meetName}`}</span>
        <h1 className="page-title">{view.title}</h1>
        <p className="body-l">{CLOSED_BODY}</p>
        <div className="try-actions"><Link className="btn ghost" href="/">What is First Meet?</Link></div>
      </main></div>
    );
  }

  const title = view.kind === 'totaled' ? `${view.name} totaled ${view.total} ${view.unit}.`
    : view.kind === 'bombed' ? `${view.name} finished her first meet.`
      : `${view.name}'s meet`;

  return (
    <div className="try-page meet-page"><main className="try-col corner-col">
      <LightsDown />
      <div className="platform-top">
        <span className="eyebrow corner-live"><i className="mini-lamp white" aria-hidden="true" />{`Live · ${view.meetName}`}</span>
        <h1 className="page-title">{title}</h1>
      </div>
      <CornerLive view={view} token={token} savedName={saved}>
        {view.kind === 'totaled' && (
          <div className="corner-after">
            {view.demo && <p className="body-l">{DEMO_LINE}</p>}
            <Link className="link" href={view.demo ? '/sample' : '/live'}>{view.demo ? 'Watch a meet night' : 'Soo is live tonight at 8 pm Eastern'}</Link>
          </div>
        )}
      </CornerLive>
    </main></div>
  );
}
