'use client';
import { useEffect, useState } from 'react';

/**
 * Keeps something on screen for `outMs` after `show` goes false, so it can fade out (look 4a's turning
 * phone: 200 ms). `out` is true while it fades. With motion off it goes at once.
 */
export function useLinger(show: boolean, outMs: number): { on: boolean; out: boolean } {
  const [leaving, setLeaving] = useState(false);
  const [was, setWas] = useState(show);
  if (show !== was) {
    // React's "adjust state while rendering": the fade starts on the same render show drops
    setWas(show);
    setLeaving(!show && !reducedMotion());
  }
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(false), outMs);
    return () => clearTimeout(t);
  }, [leaving, outMs]);
  return { on: show || leaving, out: !show && leaving };
}

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
