import Link from 'next/link';
import { Footer, Wordmark } from './chrome';

/** Plan 3.1's no-role page: a 403 in the Sheet style, never the page itself. */
export function TurnedAway({ title, body }: { title: string; body: string }) {
  return (
    <div className="wrap page">
      <header className="topbar"><Wordmark /></header>
      <main className="prose" role="alert">
        <h1 className="sheet-title">{title}</h1>
        <p className="body-l">{body}</p>
        <p><Link className="btn ghost" href="/">Go to First Meet</Link></p>
      </main>
      <Footer />
    </div>
  );
}
