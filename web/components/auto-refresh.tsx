'use client';
// Desk pages (the referee queue, /ops) re-read the server every few seconds while they're open
// and visible, so new close calls and fresh numbers appear without a reload.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function AutoRefresh({ everyMs = 15_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
