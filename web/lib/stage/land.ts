'use client';
// Look 4a: a phone on its side gets the landscape stage (the stage on the left, the panel a 340 px right
// column). The stage's root takes the `land` class, so look 4b's rotation-lock wrapper can draw the same
// layout when the screen itself didn't turn.
import { useEffect, useState } from 'react';

/** A phone on its side: wider than tall and under 600 px tall (an 844 x 390 phone, not a desktop window). */
export const LAND_QUERY = '(orientation: landscape) and (max-height: 599px)';

export function useLand(): boolean {
  const [land, setLand] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(LAND_QUERY);
    const on = () => setLand(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return land;
}
