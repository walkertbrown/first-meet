import '../platform.css';
import '../meet.css';
import { db } from '@/db';
import { hostMeet } from '@/lib/host-data';
import { LivePage } from './live-page';

// /live (plan 5.6): this season's meet night.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Meet night' };

export default async function Page() {
  const meet = await hostMeet(db());
  if (!meet) {
    return (
      <div className="wrap page live-page">
        <main><h1 className="page-title">Meet night</h1><p className="body">The next meet night isn&apos;t set yet.</p></main>
      </div>
    );
  }
  return <LivePage meet={meet} />;
}
