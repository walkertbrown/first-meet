'use client';
// "I'm ready" docks when it can't fit (look 5.6, behind item 81). The Primary's own wrapper is a
// direct child of the page column, `position: sticky` at the bottom. A 1 px sentinel straight after
// it, taking no space, marks the button's own bottom edge in its place. One IntersectionObserver,
// its root's bottom pulled up by the dock's offset B, says when that edge is below the line where
// sticky lifts the button: exactly then it is `data-docked` and shows its band. Nothing is measured
// on resize or scroll; B is read once, and again only when the phone turns (a rootMargin can't
// change, so that makes a new observer).
import { useEffect, useRef, type ReactNode } from 'react';

/** The observer's rootMargin for a dock B px above the visible bottom. */
export const dockMargin = (b: number) => `0px 0px -${Math.max(0, Math.round(b))}px 0px`;

/** Docked: the sentinel is out of the (shrunk) root and below it, not above it. */
export function isDocked(e: { isIntersecting: boolean; top: number; rootBottom: number }) {
  return !e.isIntersecting && e.top >= e.rootBottom;
}

export function ReadyDock({ children }: { children: ReactNode }) {
  const dockRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const dock = dockRef.current, sentinel = sentinelRef.current;
    if (!dock || !sentinel || typeof IntersectionObserver === 'undefined') return;
    let io: IntersectionObserver | null = null;
    const build = () => {
      io?.disconnect();
      const b = parseFloat(getComputedStyle(dock).bottom) || 0;
      io = new IntersectionObserver(entries => {
        const e = entries[entries.length - 1];
        const rootBottom = e.rootBounds?.bottom ?? window.innerHeight - b;
        if (isDocked({ isIntersecting: e.isIntersecting, top: e.boundingClientRect.top, rootBottom })) dock.dataset.docked = '';
        else delete dock.dataset.docked;
      }, { rootMargin: dockMargin(b), threshold: 0 });
      io.observe(sentinel);
    };
    build();
    const turn = window.matchMedia?.('(orientation: portrait)');
    turn?.addEventListener('change', build);
    return () => { io?.disconnect(); turn?.removeEventListener('change', build); };
  }, []);
  return (
    <>
      <div className="ready-dock" ref={dockRef}>{children}</div>
      <i className="ready-sentinel" ref={sentinelRef} aria-hidden="true" />
    </>
  );
}
