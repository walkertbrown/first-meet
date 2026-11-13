'use client';
// Look 4b: when the screen doesn't turn but gravity says the phone is on its side, the page draws look 4a's
// landscape itself. The whole page (the stage, the panel, the declare sheet, the demo strip) is laid out in
// one wrapper, the body, `100dvh` wide and `100vw` tall, turned to match gravity, so "right" is her right.
// The viewport units and safe areas the layout uses come from --vw, --vh and --sa-*, swapped here.
import { useEffect, useState } from 'react';
import { drawnInsets } from './orient';

export type Turn = 0 | 90 | -90;

/** The old layout fades out over 120 ms, the new one in over 200 ms; with motion off it swaps at once. */
export const SWAP_OUT_MS = 120;

function apply(turn: Turn) {
  const root = document.documentElement;
  root.classList.toggle('rot', turn !== 0);
  if (turn === 0) {
    root.removeAttribute('data-turn');
    for (const k of ['--sa-t', '--sa-r', '--sa-b', '--sa-l']) root.style.removeProperty(k);
    return;
  }
  root.setAttribute('data-turn', String(turn));
  const [t, r, b, l] = drawnInsets(turn);
  root.style.setProperty('--sa-t', t);
  root.style.setProperty('--sa-r', r);
  root.style.setProperty('--sa-b', b);
  root.style.setProperty('--sa-l', l);
}

/**
 * `target` is the turn gravity asks for; while `hold` is on (from "Bar is loaded." until the result is
 * in), the screen keeps the way it had, so a bump mid-lift never turns it. Returns the turn drawn now.
 */
export function useDrawnTurn(target: Turn, hold: boolean): Turn {
  const [shown, setShown] = useState<Turn>(0);
  useEffect(() => {
    if (hold || target === shown) return;
    const root = document.documentElement;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setShown(target); return; }
    root.classList.add('rot-out');
    const t = setTimeout(() => { root.classList.remove('rot-out'); setShown(target); }, SWAP_OUT_MS);
    return () => { clearTimeout(t); root.classList.remove('rot-out'); };
  }, [target, hold, shown]);
  const [swaps, setSwaps] = useState(0);
  useEffect(() => {
    apply(shown);
    setSwaps(n => n + 1);
  }, [shown]);
  useEffect(() => {
    // the first draw upright isn't a swap
    if (swaps < 2) return;
    const root = document.documentElement;
    root.classList.add('rot-in');
    const t = setTimeout(() => root.classList.remove('rot-in'), 220);
    return () => { clearTimeout(t); root.classList.remove('rot-in'); };
  }, [swaps]);
  // leaving the stage puts the page back upright
  useEffect(() => () => apply(0), []);
  return shown;
}
