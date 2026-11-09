import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters } from '@/db/schema';
import { DemoStrip } from '@/components/demo-strip';
import { TotalCheers } from '@/components/cheer-banner';
import { cornerBlock, herCheers } from '@/lib/cheers';
import { PLAN_SWITCHES } from '@/lib/plan-switches';
import { LiveRefresh } from '@/components/live-refresh';
import { currentViewer } from '@/lib/roles';
import { totalFor } from '@/lib/meet-flow';
import type { Units } from '@/lib/meet';
import { bombedWords, formatTotal, homeSum, totalLifts, totalWords, unitLine, waitingBody } from '@/lib/total-view';
import '../../try.css';
import '../../platform.css';

// "You totaled" (plan 5.28): after her ninth attempt has lights or is a close call waiting.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your total', robots: { index: false } };

export default async function TotalPage() {
  if (!hasDb()) redirect('/demo');
  const v = await currentViewer(db());
  if (!v) redirect('/demo');
  const [l] = await db().select().from(lifters).where(eq(lifters.id, v.id));
  if (!l?.meetId) redirect(v.isDemo ? '/demo' : '/');
  const t = await totalFor(db(), l);
  if (t.kind === 'lifting') redirect('/platform');
  const division = l.division;
  const units = l.units as Units;
  const strip = l.isDemo ? <DemoStrip /> : null;
  // item 80: "YOUR CORNER", the last block before the buttons in every state (5.28, look 5.10)
  const corner = PLAN_SWITCHES.item80 ? <TotalCheers initial={cornerBlock(await herCheers(db(), l.id, l.meetId))} /> : null;
  const page = (body: React.ReactNode) => <>{strip}<div className="try-page meet-page"><main className="try-col meet-col total-page">{body}</main></div></>;

  if (t.kind === 'waiting') {
    return page(<>
      <LiveRefresh />
      <h1 className="page-title">Your total is almost in.</h1>
      <p className="body">{waitingBody(t.on, division)}</p>
      <p className="so-far"><span className="weight-m num">{formatTotal(t.soFar)}<span className="unit">{units}</span></span> <span className="small">so far</span></p>
      {corner}
    </>);
  }

  if (t.kind === 'bombed') {
    const w = bombedWords(t.lift, division, l.isDemo);
    return page(<>
      <h1 className="page-title">You finished your first meet.</h1>
      <p className="body-l">{w.body}</p>
      <p className="body">{w.free}</p>
      {corner}
      <div className="try-actions">
        <Link className="btn" href={w.primary.href}>{w.primary.label}</Link>
        <Link className="btn ghost" href={w.ghost.href}>{w.ghost.label}</Link>
      </div>
    </>);
  }

  const w = totalWords(l.isDemo);
  const lifts = totalLifts(t.best, division);
  const value = formatTotal(t.value);
  return page(<>
    <span className="eyebrow">WINTER 2027</span>
    <div className="total-num" style={{ ['--chars' as string]: String(value.length) }}>
      <span className="meet-total num">{value}</span>
    </div>
    <div className="total-unit">
      <span className="eyebrow">{unitLine(units, division)}</span>
      {t.nineForNine && <span className="nine-for-nine">9 FOR 9</span>}
    </div>
    <h1 className="page-title">{`You totaled, ${l.cardName}.`}</h1>
    <dl className="total-lifts">
      {lifts.map(x => (
        <div key={x.lift}>
          <dt className="eyebrow">{x.label}</dt>
          {x.written ? <><dd className="number-s num">{x.written}</dd><dd className="small">{x.value}</dd></> : <dd className="number-s num">{x.value}</dd>}
        </div>
      ))}
    </dl>
    {division === 'home' && <p className="small total-sum">{homeSum(t.best)}</p>}
    <p className="body-l">{w.body}</p>
    {corner}
    <div className="try-actions">
      <Link className="btn" href={w.primary.href}>{w.primary.label}</Link>
      <Link className="btn ghost" href={w.ghost.href}>{w.ghost.label}</Link>
    </div>
  </>);
}
