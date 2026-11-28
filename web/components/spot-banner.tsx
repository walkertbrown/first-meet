'use client';
// 5.27's banner for a spot check (item 105): she's done lifting, so it shows the next time she opens
// First Meet. Which ones she has seen is kept on her phone; an undo has its own key, so she sees it too.
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LightsBanner } from '@/components/banner-layer';
import type { SpotBanner as Item } from '@/lib/referee/spot';

const SEEN = 'fm-spot-seen';
const QUIET = ['/host', '/ops', '/referee', '/stage', '/card', '/corner'];

function seen(): string[] {
  try { return JSON.parse(localStorage.getItem(SEEN) ?? '[]') as string[]; } catch { return []; }
}

export function SpotBanner() {
  const path = usePathname() ?? '/';
  const router = useRouter();
  const [list, setList] = useState<Item[]>([]);
  const quiet = QUIET.some(p => path.startsWith(p)) || path.startsWith('/platform/attempt/');

  useEffect(() => {
    if (quiet) return;
    let gone = false;
    fetch('/api/me/spot', { cache: 'no-store' }).then(r => (r.ok ? r.json() as Promise<Item[]> : [])).then(items => {
      if (gone) return;
      const had = new Set(seen());
      setList(items.filter(i => !had.has(i.key)));
    }).catch(() => {});
    return () => { gone = true; };
  }, [quiet]);

  const b = list[0];
  if (!b || quiet) return null;
  const done = () => {
    try { localStorage.setItem(SEEN, JSON.stringify([...seen(), b.key].slice(-50))); } catch { /* her phone may refuse */ }
    setList(l => l.slice(1));
  };
  return (
    <LightsBanner key={b.key} lights={b.lights} text={b.text} call={b.call} after={b.after}
      onDismiss={done} onOpen={() => { done(); router.push(`/platform/attempt/${b.id}`); }} />
  );
}
