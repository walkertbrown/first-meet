import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters } from '@/db/schema';
import { Certificate } from '@/components/certificate';
import { PrintButton } from '@/components/print-button';
import { cardFor, certificateFor } from '@/lib/card/card-data';
import { CARD_WORDS } from '@/lib/card/card-words';
import { currentViewer } from '@/lib/roles';
import '../../../card.css';

// The certificate (plan 5.30 Print, look 9): a US Letter page. "Print" calls window.print().
// ?embed=1 is 5.30's Print preview, which prints from its own frame, so it has no buttons of its own.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your certificate', robots: { index: false } };

export default async function CertificatePage({ searchParams }: { searchParams: Promise<{ embed?: string }> }) {
  if (!hasDb()) redirect('/demo');
  const v = await currentViewer(db());
  if (!v) redirect('/demo');
  const [l] = await db().select().from(lifters).where(eq(lifters.id, v.id));
  if (!l || l.deletedAt) redirect('/demo');
  const card = await cardFor(db(), l);
  if (!card) redirect('/platform/total');
  const c = await certificateFor(db(), card);
  const embed = (await searchParams).embed === '1';
  return (
    <div className="cert-page" data-theme="light">
      {!embed && (
        <div className="cert-actions no-print">
          <PrintButton label={CARD_WORDS.print} />
          <p className="small">{CARD_WORDS.pdf}</p>
        </div>
      )}
      <Certificate c={c} />
    </div>
  );
}
