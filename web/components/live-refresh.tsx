'use client';
// Re-reads the page when one of her attempts changes (the live stream, 3.9 step 7), with a slow
// poll behind it: "Your total is almost in" turns into the total when the referee is done (5.28).
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function LiveRefresh({ pollMs = 30_000 }: { pollMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const es = typeof EventSource !== 'undefined' ? new EventSource('/api/live') : null;
    es?.addEventListener('attempt', () => router.refresh());
    const id = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, pollMs);
    return () => { es?.close(); clearInterval(id); };
  }, [router, pollMs]);
  return null;
}
