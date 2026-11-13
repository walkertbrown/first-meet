'use client';
// A banner is above everything, sheets included (look 5.10, plan 5.24; item 92). The sheet stays
// open and keeps focus: a tap on the banner closes only the banner, and the sheet's top edge sits
// below the banner's bottom edge (`--banner-bottom`, read by platform.css).
import { useLayoutEffect, useRef, type MouseEvent } from 'react';

/** True while any bottom sheet is open. */
export const sheetOpen = () => typeof document !== 'undefined' && !!document.querySelector('.sheet-scrim');

/** On the banner's mousedown: the press never moves focus out of the sheet. */
export const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The banner's tap: with a sheet open, only the banner closes; otherwise `go` (open the attempt).
 */
export const bannerTap = (dismiss: () => void, go?: () => void) => () => {
  dismiss();
  if (go && !sheetOpen()) go();
};

/**
 * Keeps `--banner-bottom` on the root at the banner's bottom edge while it shows, so an open sheet
 * stays under it. Layout position only (offsetTop + offsetHeight), so the drop-in's transform
 * doesn't count.
 */
export function useBannerRoom<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--banner-bottom', `${Math.ceil(el.offsetTop + el.offsetHeight)}px`);
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    window.addEventListener('resize', set);
    return () => { ro?.disconnect(); window.removeEventListener('resize', set); root.style.removeProperty('--banner-bottom'); };
  }, []);
  return ref;
}

/** The lights banner (look 5.10): three mini lamps, then the line with "Good lift" or "No lift" Strong. */
export function LightsBanner({ lights, text, call, more, onDismiss, onOpen }: {
  lights: string[]; text: string; call: string; more?: string | null; onDismiss: () => void; onOpen?: () => void;
}) {
  const ref = useBannerRoom<HTMLButtonElement>();
  return (
    <button type="button" className="banner" ref={ref} onMouseDown={keepFocus} onClick={bannerTap(onDismiss, onOpen)}>
      <span className="banner-lamps" aria-hidden="true">{lights.map((l, i) => <i key={i} className={`mini-lamp ${l}`} />)}</span>
      <span className="body">
        {text}<strong>{call === 'white' ? 'Good lift' : 'No lift'}</strong>
        {more && <span className="banner-more"> {more}</span>}
      </span>
    </button>
  );
}
