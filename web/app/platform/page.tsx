import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { attempts, lifters } from '@/db/schema';
import { DemoStrip } from '@/components/demo-strip';
import { MeetAttempt } from '@/components/meet-attempt';
import { currentViewer } from '@/lib/roles';
import { demoBecause } from '@/lib/demo';
import '../try.css';
import '../platform.css';

// The demo meet's platform (plan 5.24–5.25 as phase 2 builds them, 5.36): the demo strip, then
// the demo lifter's attempt. No demo session goes to /demo.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'The platform', robots: { index: false } };

export default async function PlatformPage() {
  if (!hasDb()) redirect('/demo');
  const v = await currentViewer(db());
  if (!v || !v.isDemo || v.session.kind !== 'demo') redirect('/demo');
  const [l] = await db().select().from(lifters).where(eq(lifters.id, v.id));
  if (!l?.meetId) redirect('/demo');
  const [a] = await db().select().from(attempts)
    .where(and(eq(attempts.lifterId, l.id), eq(attempts.meetId, l.meetId))).orderBy(desc(attempts.createdAt)).limit(1);
  if (!a) redirect('/demo');

  return (
    <>
      <DemoStrip />
      <MeetAttempt
        key={a.id}
        attempt={{ id: a.id, lift: a.lift, number: a.number, weight: a.weight, reps_declared: a.repsDeclared, status: a.status }}
        lifter={{ cardName: l.cardName, ageGroup: l.ageGroup, division: l.division, units: l.units }}
        because={demoBecause(l.division, l.units)}
        voicePack={process.env.VOICE_PACK || 'team'}
      />
    </>
  );
}
