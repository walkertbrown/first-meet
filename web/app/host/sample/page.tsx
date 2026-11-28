import '../../meet.css';
import { HostLive } from '@/components/host-live';
import { db, hasDb } from '@/db';
import { sampleDeskLifters } from '@/lib/host-data';
import { SAMPLE_LIFTERS } from '@/lib/sample-meet';

// /host/sample (plan 5.36): the sample meet's desk, open to anyone. "Read" works on demo lifters who
// totaled in the last 7 days, newest first, then the sample meet's made-up lifters; a demo phone
// shows the demo words (5.29), never Soo's name. The roll call loops.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sample host desk' };

export default async function Page() {
  const { demo, sample } = hasDb() ? await sampleDeskLifters(db()) : { demo: [], sample: SAMPLE_LIFTERS };
  return (
    <main className="host-page">
      <HostLive api="/api/host/sample" night="Sample meet · Meet night" lifters={sample} demo={demo} readIds={[]} crossedIds={[]}
        liveMinutes={60} loop storeKey="host-sample" />
    </main>
  );
}
