import type { Metadata } from 'next';
import { SpotCheck } from '@/components/spot-check';
import '../../try.css';
import '../../platform.css';

// "Test your spot" from meet week (plan 5.23): the frame check alone.
export const metadata: Metadata = { title: 'Test your spot', robots: { index: false } };

export default function SpotPage() {
  return <SpotCheck back={{ href: '/meet-week', label: 'Back to meet week' }} />;
}
