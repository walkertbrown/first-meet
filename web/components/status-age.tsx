'use client';
// /status's Small line (plan 5.7): "Updated <n> seconds ago.", and the page re-reads every 15 s.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export const STATUS_REFRESH_MS = 15_000;
export const updatedWords = (s: number) => `Updated ${s} ${s === 1 ? 'second' : 'seconds'} ago.`;

export function StatusAge({ at }: { at: string }) {
  const router = useRouter();
  const [s, setS] = useState(0);
  useEffect(() => {
    const from = new Date(at).getTime();
    setS(Math.max(0, Math.round((Date.now() - from) / 1000)));
    const tick = setInterval(() => setS(Math.max(0, Math.round((Date.now() - from) / 1000))), 1000);
    const again = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, STATUS_REFRESH_MS);
    return () => { clearInterval(tick); clearInterval(again); };
  }, [at, router]);
  return <p className="small status-age" aria-live="off">{updatedWords(s)}</p>;
}
