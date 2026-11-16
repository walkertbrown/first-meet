import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters } from '@/db/schema';
import { DemoStrip } from '@/components/demo-strip';
import { CardScreen } from '@/components/card-screen';
import { cardFor, ensureCardToken } from '@/lib/card/card-data';
import { currentViewer } from '@/lib/roles';
import '../../try.css';
import '../../platform.css';
import '../../card.css';

// "Your meet card" (plan 5.30): Story, Post, Clip and Print, and the buttons that share them.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your meet card', robots: { index: false } };

export default async function MeCardPage() {
  if (!hasDb()) redirect('/demo');
  const v = await currentViewer(db());
  if (!v) redirect('/demo');
  const [l] = await db().select().from(lifters).where(eq(lifters.id, v.id));
  if (!l || l.deletedAt) redirect('/demo');
  const card = await cardFor(db(), l);
  // no total yet (still lifting, waiting on a referee, or bombed out): her total page says where she is
  if (!card) redirect('/platform/total');
  const token = await ensureCardToken(db(), l);
  const clip = card.clip;
  return (
    <>
      {l.isDemo && <DemoStrip />}
      <div className="try-page meet-page">
        <main className="try-col meet-col card-page">
          <CardScreen
            token={token}
            name={card.view.name}
            clip={{ ready: clip?.status === 'ready' && !!clip.key, shared: !!clip?.sharedAt }}
            judgesOnly={l.clipVisibility === 'judges'}
          />
        </main>
      </div>
    </>
  );
}
