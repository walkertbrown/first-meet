import Link from 'next/link';
import { Footer, Wordmark } from '@/components/chrome';

// Plan 3.11, "A page that doesn't exist", in the site's frame. Next serves it with a 404.
export const metadata = { title: 'Not here' };

export default function NotFound() {
  return (
    <div className="wrap page">
      <header className="topbar"><Wordmark /></header>
      <main className="prose">
        <h1 className="page-title">Not here</h1>
        <p className="body-l">{"This page doesn't exist, or it moved."}</p>
        <Link className="btn" href="/">Go to First Meet</Link>
      </main>
      <Footer />
    </div>
  );
}
