import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { attempts, lifters } from '@/db/schema';
import { DemoStrip } from '@/components/demo-strip';
import { AttemptLook } from '@/components/attempt-look';
import { currentViewer } from '@/lib/roles';
import { homeKind } from '@/lib/meet';
import '../../../try.css';
import '../../../platform.css';

// The banner's attempt (5.27): one of her earlier attempts, with its lights, the reason if red,
// and her clip on the judged frame with the marks. Its button goes back to the platform.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your attempt', robots: { index: false } };

export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasDb()) redirect('/demo');
  const v = await currentViewer(db());
  if (!v) redirect('/demo');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [a] = await db().select().from(attempts).where(eq(attempts.id, id));
  if (!a || a.lifterId !== v.id || a.status === 'declared') notFound();
  const [l] = await db().select().from(lifters).where(eq(lifters.id, v.id));
  return (
    <>
      {l.isDemo && <DemoStrip />}
      <AttemptLook
        attempt={{
          id: a.id, lift: a.lift, number: a.number, weight: a.weight, reps_declared: a.repsDeclared, status: a.status,
          kind: l.division === 'home' ? homeKind(a.lift, a.weight, l.homeWeights) : null,
        }}
        lifter={{ cardName: l.cardName, ageGroup: l.ageGroup, division: l.division, units: l.units }}
        voicePack={process.env.VOICE_PACK || 'team'}
        demo={l.isDemo}
      />
    </>
  );
}
