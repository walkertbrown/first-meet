'use client';
// The banner's attempt (5.27) on the stage, with "Back to the platform".
import { useRouter } from 'next/navigation';
import { MeetAttempt, type MeetAttemptProps } from '@/components/meet-attempt';

export function AttemptLook({ attempt, lifter, voicePack, demo }: Pick<MeetAttemptProps, 'attempt' | 'lifter' | 'voicePack'> & { demo: boolean }) {
  const router = useRouter();
  return (
    <MeetAttempt attempt={attempt} lifter={lifter} because="" voicePack={voicePack} demoReferee={demo}
      onNext={() => router.push('/platform')} nextLabel="Back to the platform" />
  );
}
