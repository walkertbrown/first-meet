import type { Metadata } from 'next';
import { TryLift } from '@/components/try-lift';
import { SITE, meetAway } from '@/lib/site';
import { meetLineBold } from '@/lib/stage/try-words';
import '../try.css';

export const metadata: Metadata = {
  title: 'Try a lift',
  description: 'One bodyweight squat. Your phone is the referee. Your video stays on your phone.',
};

// VOICE_PACK and the weeks to the meet are read when the page is asked for, not at build time.
export const dynamic = 'force-dynamic';

export default function TryPage() {
  const meetLine = meetLineBold(SITE.meet.short, SITE.meet.dates, meetAway());
  return <TryLift meetLine={meetLine} voicePack={process.env.VOICE_PACK || 'team'} />;
}
