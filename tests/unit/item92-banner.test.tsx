// Item 92 (2): a banner is above everything, sheets included (look 5.10, plan 5.24). With a sheet
// open, a tap on the banner closes only the banner: the sheet stays open and keeps focus, and its
// top edge sits under the banner.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MouseEvent } from 'react';
import { bannerTap, keepFocus, LightsBanner, sheetOpen } from '../../web/components/banner-layer';

const css = (f: string) => readFileSync(join(__dirname, '../../web/app', f), 'utf8');
const zOf = (src: string, sel: string) => Number(src.match(new RegExp(`${sel.replace('.', '\\.')} \\{[^}]*z-index: (\\d+)`))![1]);

/** A document with or without an open sheet: only `.sheet-scrim` is ever asked for. */
const withSheet = (open: boolean) => vi.stubGlobal('document', { querySelector: (s: string) => (s === '.sheet-scrim' && open ? {} : null) });
afterEach(() => vi.unstubAllGlobals());

describe('item 92: the banner over a sheet', () => {
  it('with a sheet open, the tap closes only the banner and never opens the attempt', () => {
    withSheet(true);
    expect(sheetOpen()).toBe(true);
    const dismiss = vi.fn(), go = vi.fn();
    bannerTap(dismiss, go)();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(go).not.toHaveBeenCalled();
  });

  it('with no sheet open, the tap closes the banner and opens the attempt', () => {
    withSheet(false);
    expect(sheetOpen()).toBe(false);
    const dismiss = vi.fn(), go = vi.fn();
    bannerTap(dismiss, go)();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(go).toHaveBeenCalledOnce();
  });

  it('the press never takes focus from the sheet', () => {
    const e = { preventDefault: vi.fn() } as unknown as MouseEvent;
    keepFocus(e);
    expect(e.preventDefault).toHaveBeenCalledOnce();
  });

  it('is a button with the lamps and "Good lift" or "No lift" in Strong', () => {
    const html = renderToStaticMarkup(<LightsBanner lights={['white', 'white', 'red']} text="Your second squat: " call="white" more="Your next attempt stays as declared." onDismiss={() => {}} />);
    expect(html).toMatch(/^<button type="button" class="banner">/);
    expect(html.match(/class="mini-lamp /g)).toHaveLength(3);
    expect(html).toContain('<strong>Good lift</strong>');
    expect(html).toContain('<span class="banner-more"> Your next attempt stays as declared.</span>');
    expect(renderToStaticMarkup(<LightsBanner lights={['red', 'red', 'red']} text="x " call="red" onDismiss={() => {}} />)).toContain('<strong>No lift</strong>');
  });

  it('sits above the sheet scrim and the corner player, and an open sheet stops under it', () => {
    const p = css('platform.css'), c = css('corner.css');
    const banner = zOf(p, '.banner');
    expect(banner).toBeGreaterThan(zOf(p, '.sheet-scrim'));
    expect(banner).toBeGreaterThan(zOf(c, '.corner-player'));
    expect(p).toContain(':root:has(.banner) .bottom-sheet { max-height: calc(var(--vh) - var(--banner-bottom, 24px) - 8px); }');
  });

  it('every banner uses the shared layer: its room on the root, and the press that keeps focus', () => {
    for (const f of ['platform.tsx', 'done-live.tsx', 'corner.tsx']) {
      expect(readFileSync(join(__dirname, '../../web/components', f), 'utf8'), f).toMatch(/<LightsBanner\b/);
    }
    const cheer = readFileSync(join(__dirname, '../../web/components/cheer-banner.tsx'), 'utf8');
    expect(cheer).toMatch(/className="banner cheer-banner"[^>]*ref=\{room\}[^>]*onMouseDown=\{keepFocus\}/);
  });
});
