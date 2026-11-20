import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { db, hasDb } from '@/db';
import { Footer } from '@/components/chrome';
import { WatchHerLift } from '@/components/watch-her-lift';
import { cardForToken, clipOnCardLink } from '@/lib/card/card-data';
import { ogTitle, publicBody } from '@/lib/card/card-view';
import '../../try.css';
import '../../platform.css';
import '../../card.css';

// Her public meet card (plan 5.5): anyone with the link. Her clip plays here only once it's on her card
// link (item 99). A deleted account's card goes with it (5.34).
export const dynamic = 'force-dynamic';

const load = cache(async (token: string) => (hasDb() ? cardForToken(db(), token) : null));

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const card = await load(token);
  if (!card) return { title: 'Meet card', robots: { index: false } };
  const title = ogTitle(card.view);
  const image = { url: `/api/card/${token}.png?f=post`, width: 1080, height: 1350, alt: `${card.view.name}'s meet card` };
  return {
    title: { absolute: title },
    description: publicBody(card.view.name),
    robots: { index: false, follow: true },
    openGraph: { title, description: publicBody(card.view.name), images: [image], type: 'website' },
    twitter: { card: 'summary_large_image', title, images: [image.url] },
  };
}

export default async function PublicCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const card = await load(token);
  if (!card) notFound();
  const clip = clipOnCardLink(card.lifter.clipVisibility, card.clip);
  return (
    <div className="try-page meet-page">
      <main className="try-col meet-col card-page public-card">
        <WatchHerLift token={token} name={card.view.name} clip={clip} />
        <p className="body-l">{publicBody(card.view.name)}</p>
        <div className="try-actions">
          <Link className="btn" href="/try">Try a lift yourself</Link>
          <Link className="btn ghost" href="/">What is First Meet?</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
