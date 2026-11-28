// A tap before the page runs is kept and sent once it's ready (web/lib/early-taps.ts; The Playner, Nov 28).
import { describe, expect, it } from 'vitest';
import { EARLY_HELD, earlyTapScript, replayEarlyTap } from '@/lib/early-taps';

/** Just enough of a page: buttons with attributes, document.querySelector and a capturing click listener. */
function page() {
  const clicks: string[] = [];
  const els: { attrs: Record<string, string>; click: () => void }[] = [];
  const button = (id: string) => {
    const el = {
      attrs: { 'data-early': id } as Record<string, string>,
      getAttribute: (k: string) => el.attrs[k] ?? null, setAttribute: (k: string, v: string) => { el.attrs[k] = v; },
      removeAttribute: (k: string) => { delete el.attrs[k]; }, closest: () => el, click: () => { clicks.push(id); },
    };
    els.push(el); return el;
  };
  let listener: ((e: unknown) => void) | null = null;
  const document = {
    addEventListener: (type: string, fn: (e: unknown) => void, capture: boolean) => { if (type === 'click' && capture) listener = fn; },
    querySelector: (sel: string) => {
      const held = sel === `[${EARLY_HELD}]`; const m = /^\[data-early="(.+)"\]$/.exec(sel);
      return els.find(e => held ? EARLY_HELD in e.attrs : m && e.attrs['data-early'] === m[1]) ?? null;
    },
  };
  const w = { document } as unknown as Window & Record<string, unknown>;
  new Function('window', 'document', earlyTapScript)(w, document);
  const tap = (el: ReturnType<typeof button>) => {
    const e = { target: el, stopped: false, prevented: false, preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; } };
    listener!(e); return e;
  };
  return { w, button, tap, clicks };
}

describe('a tap before the page runs', () => {
  it('is held (the button at 85%), not lost, and only the last one tapped is kept', () => {
    const { w, button, tap } = page();
    const a = button('try-camera'); const b = button('try-sample');
    const e = tap(a);
    expect(e.prevented && e.stopped).toBe(true);
    expect(EARLY_HELD in a.attrs).toBe(true);
    tap(b);
    expect(EARLY_HELD in a.attrs).toBe(false);
    expect(EARLY_HELD in b.attrs).toBe(true);
    expect(w.__fmEarly).toBe('try-sample');
  });
  it('is sent once the page runs, once; after that taps go straight to the page', () => {
    const { w, button, tap, clicks } = page();
    const a = button('copy-corner');
    tap(a);
    expect(replayEarlyTap(w)).toBe('copy-corner');
    expect(clicks).toEqual(['copy-corner']);
    expect(EARLY_HELD in a.attrs).toBe(false);
    expect(replayEarlyTap(w)).toBeNull();
    const later = tap(a);
    expect(later.prevented || later.stopped).toBe(false);
    expect(clicks).toEqual(['copy-corner']);
  });
  it('with no early tap, nothing is tapped', () => {
    const { w, button, clicks } = page();
    button('ready');
    expect(replayEarlyTap(w)).toBeNull();
    expect(clicks).toEqual([]);
  });
});

describe('the held fill is look 5.1 loading: 85%', () => {
  it('in globals.css', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('web/app/globals.css', 'utf8')).toContain('[data-early-held] { opacity: .85; }');
  });
});
