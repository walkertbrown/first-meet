import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Footer, Wordmark } from '@/components/chrome';
import { db, hasDb } from '@/db';
import { testMeetExists, testSigninOn } from '@/lib/test-signin';

// Staging's test accounts (plan 3.1). Anywhere else this page doesn't exist.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Test sign-in', robots: { index: false } };

export default async function Page() {
  if (!testSigninOn(process.env, (await headers()).get('host'))) notFound();
  const testMeet = hasDb() && await testMeetExists(db());
  return (
    <div className="wrap page">
      <header className="topbar"><Wordmark /></header>
      <main className="prose">
        <h1 className="page-title">Test sign-in</h1>
        <p className="small">Staging only. These accounts are made up, and production has no such page.</p>
        <form method="post" action="/api/signin/test" className="stack">
          <button className="btn" name="who" value="referee" type="submit">Sign in as the test referee</button>
          <button className="btn ghost" name="who" value="admin" type="submit">Sign in as the test admin</button>
          <button className="btn ghost" name="who" value="lifter" type="submit">Sign in as a test lifter</button>
          <button className="btn ghost" name="who" value="meetweek" type="submit">Sign in as a test lifter in meet week</button>
          <button className="btn ghost" name="who" value="meetweek-home" type="submit">Sign in as a test lifter in meet week, Home</button>
          {testMeet && <button className="btn ghost" name="who" value="hour-now" type="submit">Set the test meet&apos;s flight hour now</button>}
        </form>
      </main>
      <Footer />
    </div>
  );
}
