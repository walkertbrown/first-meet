'use client';
// The line under the lamps (look 5.25 step 8): one line crossfades into the next over 400 ms,
// the old line fading out on top of the new one fading in, so a change never reads as a glitch.
import { useEffect, useRef, useState } from 'react';

export const CROSSFADE_MS = 400;

export function WaitLine({ text }: { text: string }) {
  const [now, setNow] = useState({ text, prev: '', n: 0 });
  const last = useRef(text);
  useEffect(() => {
    if (text === last.current) return;
    const prev = last.current;
    last.current = text;
    // going quiet: the whole line fades out with its words still on it
    if (!text) return;
    setNow(s => ({ text, prev, n: s.n + 1 }));
    if (!prev) return;
    const t = setTimeout(() => setNow(s => (s.text === text ? { ...s, prev: '' } : s)), CROSSFADE_MS);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <div className={`waitline${text ? ' on' : ''}`} aria-live="polite">
      {now.prev && <span key={`out-${now.n}`} className="wl-out" aria-hidden="true">{now.prev}</span>}
      <span key={`in-${now.n}`} className={now.prev ? 'wl-in' : undefined}>{now.text}</span>
    </div>
  );
}
