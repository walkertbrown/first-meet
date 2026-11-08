import Link from 'next/link';
import { Footer, Wordmark } from './chrome';

/** A page that a later phase builds. Its link works now so nothing on the site is dead. */
export function Later({ title, phase }: { title: string; phase: number }) {
  return (
    <div className="wrap page">
      <header className="topbar"><Wordmark /></header>
      <main className="prose">
        <h1 className="page-title">{title}</h1>
        <p className="body-l">This part of First Meet is still being built. It arrives in phase {phase} of the build.</p>
        <p><Link className="btn" href="/try">Try a lift</Link></p>
      </main>
      <Footer />
    </div>
  );
}
