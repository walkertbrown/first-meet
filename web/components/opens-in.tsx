'use client';
// 5.24 before the window: "The platform opens in <d h m>", and "Friday at 6 am Eastern (<local time>)."
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const lower = (s: string) => s.replace(':00', '').replace(' AM', ' am').replace(' PM', ' pm');

export function opensInText(ms: number) {
  const m = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return [d ? `${d}d` : '', d || h ? `${h}h` : '', `${mm}m`].filter(Boolean).join(' ');
}

export function OpensIn({ at }: { at: string }) {
  const router = useRouter();
  const t = new Date(at).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const i = setInterval(() => { setNow(Date.now()); if (Date.now() >= t) router.refresh(); }, 15_000);
    return () => clearInterval(i);
  }, [t, router]);
  const d = new Date(at);
  const et = lower(d.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }));
  const local = now === null ? null : lower(d.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' }));
  const [day, time] = et.split(', ');
  return (
    <>
      <h1 className="page-title">{`The platform opens in ${opensInText(t - (now ?? t))}`}</h1>
      <p className="body-l">{`${day} at ${time} Eastern${local ? ` (${local.split(', ').join(' at ')})` : ''}.`}</p>
    </>
  );
}
