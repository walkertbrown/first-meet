import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters } from '@/db/schema';
import { LightsDown } from '@/components/lights-down';
import { currentViewer } from '@/lib/roles';

// 5.24: "Meet weekend; Lights down unless she chose Day." Every platform screen (5.24–5.28).
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  let day = false;
  if (hasDb()) {
    const v = await currentViewer(db());
    if (v) {
      const [l] = await db().select({ theme: lifters.theme }).from(lifters).where(eq(lifters.id, v.id));
      day = l?.theme === 'day';
    }
  }
  return <>{!day && <LightsDown />}{children}</>;
}
