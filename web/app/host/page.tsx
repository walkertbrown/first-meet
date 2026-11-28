import '../meet.css';
import { forbidden } from 'next/navigation';
import { HostLive } from '@/components/host-live';
import { db } from '@/db';
import { hostMeet, meetLifters, readIds } from '@/lib/host-data';
import { currentViewer } from '@/lib/roles';

// /host (plan 5.35, look 5.12): Soo's desk, screen-shared at 1920 × 1080. The host, or an admin.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Host desk', robots: { index: false } };

export default async function Page() {
  const v = await currentViewer(db());
  if (!v || (!v.isHost && !v.isAdmin)) forbidden();
  const meet = await hostMeet(db());
  const lifters = meet ? (await meetLifters(db(), meet.id)).map(({ createdAt: _, ...l }) => l) : [];
  const read = meet ? [...await readIds(db(), meet.id, 'read')] : [];
  const crossed = meet ? [...await readIds(db(), meet.id, 'rollcall')] : [];
  return (
    <main className="host-page">
      <HostLive api="/api/host" night={`${meet?.name ?? 'Winter 2027'} · Meet night`} lifters={lifters} readIds={read} crossedIds={crossed}
        liveMinutes={meet?.liveMinutes ?? 60} storeKey={`host:${meet?.id ?? 'none'}`} />
    </main>
  );
}
