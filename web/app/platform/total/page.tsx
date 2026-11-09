import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters, meets } from '@/db/schema';
import { DemoStrip } from '@/components/demo-strip';
import { TotalCheers } from '@/components/cheer-banner';
import { cornerBlock, herCheers } from '@/lib/cheers';
import { PLAN_SWITCHES } from '@/lib/plan-switches';
import { LiveRefresh } from '@/components/live-refresh';
import { currentViewer } from '@/lib/roles';
import { totalFor } from '@/lib/meet-flow';
import { LIFTS, type MeetAttempt, type Units } from '@/lib/meet';
import { clipDeadline, meetClosed, pastDeadline } from '@/lib/meet-window';
import { judgingClipBody, lateLine } from '@/lib/stage/meet-words';
import { judgingState } from '@/lib/attempt-state';
import { WindowText } from '@/components/window-words';
import { SeenBombed, TotalFigures } from '@/components/total-figures';
import { ResumeSending } from '@/components/resume-sending';
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
  const [m] = await db().select().from(meets).where(eq(meets.id, l.meetId));
  const now = new Date();
  const t = await totalFor(db(), l, undefined, undefined, now);
  if (t.kind === 'lifting') redirect('/platform');
  // after the close, until the clip deadline, a late clip can still land (3.8): keep listening
  const closed = !!m && meetClosed(m, now);
  const lateCanLand = closed && !pastDeadline(m, now);
  const storeKey = `${l.id}:${l.meetId}`;
  const division = l.division;
  const units = l.units as Units;
  const strip = l.isDemo ? <DemoStrip /> : null;
  // item 80: "YOUR CORNER", the last block before the buttons in every state (5.28, look 5.10)
  const corner = PLAN_SWITCHES.item80 ? <TotalCheers initial={cornerBlock(await herCheers(db(), l.id, l.meetId))} /> : null;
  // a clip still on this phone keeps sending from here (item 85); no attempt screen is sending it
  const page = (body: React.ReactNode) => <>{strip}<ResumeSending /><div className="try-page meet-page"><main className="try-col meet-col total-page">{body}</main></div></>;

  if (t.kind === 'waiting') {
    return page(<>
      <LiveRefresh />
      <h1 className="page-title">Your total is almost in.</h1>
      <p className="body">{waitingBody(t.on, division)}</p>
      <p className="so-far"><span className="weight-m num">{formatTotal(t.soFar)}<span className="unit">{units}</span></span> <span className="small">so far</span></p>
      {corner}
    </>);
  }

  if (t.kind === 'waiting_clip') {
    const deadline = clipDeadline(m)!.toISOString();
    const still = t.on.status === 'recording' || t.on.status === 'uploading';
    const j = !still && t.on.id ? await judgingState(db(), t.on.id).catch(() => null) : null;
    return page(<>
      <LiveRefresh />
      <h1 className="page-title">Your total is almost in.</h1>
      <p className="body">{still
        ? <WindowText say={{ kind: 'waiting', lift: t.on.lift, number: t.on.number, division, deadline }} />
        : judgingClipBody(t.on, division, j?.minutes ?? null, j?.state === 'paused')}</p>
      <p className="so-far"><span className="weight-m num">{formatTotal(t.soFar)}<span className="unit">{units}</span></span> <span className="small">so far</span></p>
      {corner}
    </>);
  }

  if (t.kind === 'bombed') {
    const w = bombedWords(t.lift, division, l.isDemo);
    return page(<>
      {lateCanLand && <LiveRefresh />}
      <SeenBombed storeKey={storeKey} />
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
  const late = closed ? lateLift(t.best, m.closesAt!) : null;
  return page(<>
    {lateCanLand && <LiveRefresh />}
    <span className="eyebrow">WINTER 2027</span>
    <TotalFigures storeKey={storeKey} value={t.value} valueText={value} unitLine={unitLine(units, division)}
      nineForNine={t.nineForNine} lifts={lifts} title={`You totaled, ${l.cardName}.`}
      late={late ? { lift: late.lift, line: lateLine(late, division) } : null} />
    {division === 'home' && <p className="small total-sum">{homeSum(t.best)}</p>}
    <p className="body-l">{w.body}</p>
    {corner}
    <div className="try-actions">
      <Link className="btn" href={w.primary.href}>{w.primary.label}</Link>
      <Link className="btn ghost" href={w.ghost.href}>{w.ghost.label}</Link>
    </div>
  </>);
}

/** The lift in her total whose clip landed after the close, the latest if more than one (3.8). */
function lateLift(best: Record<string, MeetAttempt>, closesAt: Date): MeetAttempt | null {
  return LIFTS.map(l => best[l]).filter(a => a.uploadedAt && a.uploadedAt > closesAt)
    .sort((a, b) => b.uploadedAt!.getTime() - a.uploadedAt!.getTime())[0] ?? null;
}
