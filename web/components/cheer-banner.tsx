'use client';
// Her cheers on meet weekend (plan 5.24, 5.27, 5.28, item 80; look 5.10): the banners on /platform and
// /platform/total, held while she may be under a bar, and "YOUR CORNER" on her total.
import { useCallback, useEffect, useRef, useState } from 'react';
import { waitingParts, type HerCheer, type Part } from '@/lib/cheer-words';

export type Corner = { line: Part[]; count: string };
export type Shown<L> = { kind: 'lights'; b: L; k: number } | { kind: 'cheer'; list: HerCheer[]; k: number };

let K = 0;
/**
 * What the banner does next (look 5.10), or null for nothing:
 * - while she's busy (from "I'm ready" until her result panel has settled), no banner: one showing goes;
 * - a lights banner goes before a waiting cheer;
 * - cheers that waited (while she lifted, or was away) come together in one banner;
 * - a cheer landing while a cheer banner shows takes its place, and its 8 s starts again.
 */
export function step<L>(s: { busy: boolean; shown: Shown<L> | null; lights: L[]; unseen: HerCheer[] }): { shown: Shown<L> | null; lights: L[]; seen: string[] } | null {
  if (s.busy) return s.shown ? { shown: null, lights: s.lights, seen: [] } : null;
  if (!s.shown && s.lights.length) return { shown: { kind: 'lights', b: s.lights[0], k: ++K }, lights: s.lights.slice(1), seen: [] };
  if ((!s.shown || s.shown.kind === 'cheer') && s.unseen.length) {
    return { shown: { kind: 'cheer', list: s.unseen, k: ++K }, lights: s.lights, seen: s.unseen.map(c => c.id) };
  }
  return null;
}

/** Her cheers this meet: those no banner has shown yet, and her corner's line; re-read as each lands. */
export function useCheerFeed(initialCorner: Corner | null = null) {
  const [unseen, setUnseen] = useState<HerCheer[]>([]);
  const [corner, setCorner] = useState<Corner | null>(initialCorner);
  const shownIds = useRef(new Set<string>());
  const load = useCallback(async () => {
    const r = await fetch('/api/meet/cheers', { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
    const body = r?.ok ? await r.json().catch(() => null) as { unseen: HerCheer[]; corner: Corner | null } | null : null;
    if (!body) return;
    // a banner already showed these here; its "seen" may still be on its way
    setUnseen(body.unseen.filter(c => !shownIds.current.has(c.id)));
    setCorner(body.corner);
  }, []);
  useEffect(() => {
    void load();
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/live');
    es.addEventListener('cheer', () => void load());
    return () => es.close();
  }, [load]);
  const seen = useCallback((ids: string[]) => {
    ids.forEach(id => shownIds.current.add(id));
    setUnseen(u => u.filter(c => !ids.includes(c.id)));
    void fetch('/api/meet/cheers', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) }).catch(() => null);
  }, []);
  return { unseen, corner, seen };
}

/** The platform's one banner at a time: referee lights (L) and cheers; 8 s each. */
export function useBanners<L>(busy: boolean, initialCorner: Corner | null = null) {
  const feed = useCheerFeed(initialCorner);
  const [shown, setShown] = useState<Shown<L> | null>(null);
  const [lights, setLights] = useState<L[]>([]);
  const { unseen, seen } = feed;
  useEffect(() => {
    const r = step({ busy, shown, lights, unseen });
    if (!r) return;
    setShown(r.shown); setLights(r.lights);
    if (r.seen.length) seen(r.seen);
  }, [busy, shown, lights, unseen, seen]);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 8000);
    return () => clearTimeout(t);
  }, [shown?.k]); // eslint-disable-line react-hooks/exhaustive-deps
  // a lights banner waits its turn (step, above)
  const pushLights = useCallback((b: L) => setLights(q => [...q, b]), []);
  const dismiss = useCallback(() => setShown(null), []);
  return { shown, pushLights, dismiss, corner: feed.corner };
}

export const PartsText = ({ parts }: { parts: Part[] }) => <>{parts.map((p, i) => (p.strong ? <strong key={i}>{p.t}</strong> : <span key={i}>{p.t}</span>))}</>;

/**
 * The cheer banner (look 5.10): the lights banner with no lamps, the name Strong; a newer line
 * crossfades in (200 ms) over the last. `role="status"`, no sound. A tap puts it away.
 */
export function CheerBanner({ list, k, onDismiss }: { list: HerCheer[]; k: number; onDismiss: () => void }) {
  const [layers, setLayers] = useState([{ k, list }]);
  useEffect(() => {
    setLayers(ls => (ls[ls.length - 1].k === k ? ls : [ls[ls.length - 1], { k, list }]));
    const t = setTimeout(() => setLayers(ls => ls.slice(-1)), 200);
    return () => clearTimeout(t);
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="banner cheer-banner" role="status" onClick={onDismiss}>
      <span className="cheer-lines">
        {layers.map((l, i) => (
          <span key={l.k} className={`body cheer-line${layers.length > 1 ? (i === 0 ? ' leaving' : ' coming') : ''}`} aria-hidden={i < layers.length - 1 || undefined}>
            <PartsText parts={waitingParts(l.list)} />
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * "YOUR CORNER" on her total (5.28, look 5.10): the last block before the buttons. A first cheer
 * opens the block; a later one crossfades the names and the count. With none, nothing at all.
 */
export function YourCorner({ corner }: { corner: Corner | null }) {
  const first = useRef(corner);
  if (!corner) return null;
  const text = corner.line.map(p => p.t).join('') + corner.count;
  return (
    <section className={first.current ? 'your-corner' : 'your-corner opening'} aria-label="Your corner">
      <div className="your-corner-in">
        <span className="eyebrow">YOUR CORNER</span>
        <p className="body your-corner-names fade-in" key={`n${text}`}><PartsText parts={corner.line} /></p>
        <p className="small your-corner-count fade-in" key={`c${text}`}>{corner.count}</p>
      </div>
    </section>
  );
}

/**
 * The total page's cheers (5.28): a banner as each lands, never over the reveal (the count-up's
 * 520 ms; at once with motion off), and her corner, live.
 */
export function TotalCheers({ initial }: { initial: Corner | null }) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const off = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setRevealed(true), off ? 0 : 520);
    return () => clearTimeout(t);
  }, []);
  const { shown, dismiss, corner } = useBanners<never>(!revealed, initial);
  return (
    <>
      <YourCorner corner={corner} />
      {shown?.kind === 'cheer' && <CheerBanner list={shown.list} k={shown.k} onDismiss={dismiss} />}
    </>
  );
}
