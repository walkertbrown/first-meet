'use client';
import { useEffect, useState } from 'react';
import { Lamps, type LampState } from './lamps';

/** Plan 5.1: three unlit 44 px lamps; after 800 ms they light white left to right,
 *  330 ms apart, with the thock muted. Motion off shows them lit. */
export function LandingLamps() {
  const [lit, setLit] = useState(0);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLit(3);
      setSettled(true);
      return;
    }
    const ts = [0, 1, 2].map(i => setTimeout(() => setLit(i + 1), 800 + i * 330));
    return () => ts.forEach(clearTimeout);
  }, []);
  const states: LampState[] = [0, 1, 2].map(i => (i < lit ? 'white' : 'off'));
  return <Lamps states={states} size={44} className="landing-lamps" settled={settled} />;
}
