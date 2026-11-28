// "Watch the moment" (plan 5.29), the link in her read-out email: the stream while Soo is live, the
// replay at the moment once it's saved, and until then the words that say so. One link, so the
// email stays right as the night goes on.
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Footer, Wordmark } from '@/components/chrome';
import { db } from '@/db';
import { meets, readouts } from '@/db/schema';
import { NO_REPLAY_YET, momentHref } from '@/lib/host-data';

export const dynamic = 'force-dynamic';

export default async function Moment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db().select({ r: readouts, m: meets }).from(readouts).innerJoin(meets, eq(meets.id, readouts.meetId)).where(eq(readouts.id, id));
  if (!row || row.m.kind === 'demo') notFound();
  const href = momentHref(row.m, row.r.at);
  if (href) redirect(href);
  return (
    <div className="wrap page">
      <header className="topbar"><Wordmark /></header>
      <main className="prose">
        <h1 className="sheet-title">Watch the moment</h1>
        <p className="body-l">{NO_REPLAY_YET}</p>
        <p><Link className="btn ghost" href="/live">Watch meet night</Link></p>
      </main>
      <Footer />
    </div>
  );
}
