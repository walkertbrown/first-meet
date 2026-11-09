'use client';
// Her nine after the close or after all nine (5.24, 5.28): the list moves as lights land, like
// /platform/total, and a referee's or a late clip's lights come with the banner (5.27, 3.8 "Its
// lights come as any lights do, with the banner"). A slow poll sits behind the live stream.
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { CheerBanner, useBanners } from '@/components/cheer-banner';
import { apiFetch } from '@/lib/stage/server-clock';
import { liftWord, meetResult } from '@/lib/stage/meet-words';

type Banner = { id: string; text: string; call: 'white' | 'red'; lights: ('white' | 'red')[] };
type Judged = { lift: string; number: number; weight: number; reps_declared: number | null; call: 'white' | 'red' | 'close' | null; lights: ('white' | 'red')[] | null; reason: string | null; red_rep: number | null };

export function DoneLive({ waiting, division, units, pollMs = 30_000 }: {
  /** Her attempts still waiting on lights: a close call, or a clip still sending or with the judges. */
  waiting: string[]; division: 'barbell' | 'home'; units: 'lb' | 'kg'; pollMs?: number;
}) {
  const router = useRouter();
  const { shown, pushLights, dismiss } = useBanners<Banner>(false);
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;

  useEffect(() => {
    const es = typeof EventSource !== 'undefined' ? new EventSource('/api/live') : null;
    es?.addEventListener('attempt', async ev => {
      const { attempt_id: id, status } = JSON.parse((ev as MessageEvent).data) as { attempt_id: string; status: string };
      if (status === 'judged' && waitingRef.current.includes(id)) {
        const r = await apiFetch(`/api/attempts/${id}`).catch(() => null);
        const a = r?.ok ? await r.json() as Judged : null;
        if (a && (a.call === 'white' || a.call === 'red')) {
          const res = meetResult(a)!;
          const what = division === 'home' ? `${a.reps_declared} reps` : `${a.weight} ${units}`;
          pushLights({ id, text: `${liftWord(a.lift, division)} ${a.number} · ${what} · `, call: a.call, lights: res.lamps.filter((l): l is 'white' | 'red' => l === 'white' || l === 'red') });
        }
      }
      router.refresh();
    });
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, pollMs);
    return () => { es?.close(); clearInterval(t); };
  }, [division, units, router, pushLights, pollMs]);

  if (shown?.kind === 'cheer') return <CheerBanner list={shown.list} k={shown.k} onDismiss={dismiss} />;
  if (shown?.kind !== 'lights') return null;
  const b = shown.b;
  return (
    <button type="button" className="banner" key={shown.k} onClick={() => { dismiss(); router.push(`/platform/attempt/${b.id}`); }}>
      <span className="banner-lamps" aria-hidden="true">{b.lights.map((l, i) => <i key={i} className={`mini-lamp ${l}`} />)}</span>
      <span className="body">{b.text}<strong>{b.call === 'white' ? 'Good lift' : 'No lift'}</strong></span>
    </button>
  );
}
