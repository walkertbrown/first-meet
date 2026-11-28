import { Footer, Wordmark } from '@/components/chrome';
import { LightsDown } from '@/components/lights-down';
import { SampleReplay } from '@/components/sample-replay';
import '../platform.css';
import '../referee.css';
import '../meet.css';

// Watch a meet night (plan 5.3): always Lights down; a made-up meet in a 90-second replay.
export const metadata = { title: 'Watch a meet night' };

export default function Page() {
  return (
    <div className="wrap page sample-page">
      <LightsDown />
      <header className="topbar"><Wordmark /></header>
      <main>
        <span className="eyebrow">SAMPLE MEET · MADE-UP LIFTERS</span>
        <h1 className="page-title">A meet night, start to finish</h1>
        <p className="body sample-intro">This is what meet night looks like. The lifters and their lifts are made up. The host desk&apos;s read-outs are shown as text, with no voice.</p>
        <SampleReplay />
      </main>
      <Footer />
    </div>
  );
}
