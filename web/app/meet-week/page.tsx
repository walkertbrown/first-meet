import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters } from '@/db/schema';
import { MeetWeek } from '@/components/meet-week';
import { currentViewer } from '@/lib/roles';
import { meetWeekPlace } from '@/lib/meet-week';
import '../try.css';
import '../platform.css';
import '../meet-week.css';

// Meet week (plan 5.23): from the Monday of week 12 until the window opens. Before then it is her
// block's home; from the window it is the platform.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Meet week', robots: { index: false } };

export default async function MeetWeekPage() {
  if (!hasDb()) redirect('/');
  const v = await currentViewer(db());
  if (!v) redirect('/');
  const [l] = await db().select().from(lifters).where(eq(lifters.id, v.id));
  if (!l) redirect('/');
  const place = await meetWeekPlace(db(), l);
  if (place.kind === 'weekend') redirect('/platform');
  if (place.kind !== 'week') redirect('/');
  const w = place.view;
  return (
    <div className="try-page meet-page"><main className="try-col meet-col mw-col">
      <MeetWeek
        meetId={w.meetId} units={w.units} division={w.division} bar={w.bar} openers={w.openers} cornerToken={w.cornerToken}
        flight={w.flight && { counts: w.flight.counts, mine: w.flight.mine, open: w.flight.open, hour: w.flight.hour, starts: w.flight.starts.map(d => d.toISOString()) }}
      />
    </main></div>
  );
}
