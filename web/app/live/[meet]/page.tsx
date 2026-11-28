import '../../platform.css';
import '../../meet.css';
import { and, eq, inArray } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { meets } from '@/db/schema';
import { LivePage } from '../live-page';

// /live/<meet> (plan 5.6): one meet's night, by its slug.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Meet night' };

export default async function Page({ params }: { params: Promise<{ meet: string }> }) {
  const { meet: slug } = await params;
  const [meet] = await db().select().from(meets).where(and(eq(meets.slug, slug), inArray(meets.kind, ['real', 'test'])));
  if (!meet) notFound();
  return <LivePage meet={meet} />;
}
