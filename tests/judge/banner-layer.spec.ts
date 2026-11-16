// Item 92 (2), in Chromium on the real stylesheets: a banner over an open bottom sheet (look 5.10).
// The banner takes the tap at its middle, the sheet's top edge is under the banner's bottom, and
// with the banner gone the sheet keeps its usual 24 px. No server: the CSS is read from web/app.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = ['globals.css', 'platform.css', 'corner.css'].map(f => readFileSync(join(__dirname, '../../web/app', f), 'utf8')).join('\n');
const SHEET = `<div class="sheet-scrim"><div class="bottom-sheet" role="dialog" aria-modal="true">
  <h2>Declare your opener</h2>${'<p class="body">A long sheet, taller than the screen.</p>'.repeat(80)}
  <button type="button" id="in-sheet">Declare</button></div></div>`;
const BANNER = `<button type="button" class="banner"><span class="banner-lamps" aria-hidden="true"><i class="mini-lamp white"></i><i class="mini-lamp white"></i><i class="mini-lamp red"></i></span><span class="body">Your second squat: <strong>Good lift</strong><span class="banner-more"> Your next attempt stays as declared.</span></span></button>`;

for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 1280, height: 800 }]) {
  test(`a banner over an open sheet at ${vp.width}×${vp.height}: on top, and the sheet stops under it`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.emulateMedia({ reducedMotion: 'reduce' }); // no drop-in: measure where things settle
    await page.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body>${SHEET}${BANNER}</body></html>`);
    // what useBannerRoom does: the banner's layout bottom on the root
    await page.evaluate(() => {
      const b = document.querySelector<HTMLElement>('.banner')!;
      document.documentElement.style.setProperty('--banner-bottom', `${Math.ceil(b.offsetTop + b.offsetHeight)}px`);
    });
    const r = await page.evaluate(() => {
      const b = document.querySelector('.banner')!.getBoundingClientRect();
      const s = document.querySelector('.bottom-sheet')!.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { bBottom: b.bottom, sTop: s.top, hitBanner: !!hit?.closest('.banner') };
    });
    expect(r.hitBanner, 'the tap at the banner\'s middle lands on the banner').toBe(true);
    expect(r.sTop, 'the sheet\'s top edge is under the banner').toBeGreaterThanOrEqual(r.bBottom);
    // with the banner gone, the sheet keeps its usual room
    await page.evaluate(() => { document.querySelector('.banner')!.remove(); document.documentElement.style.removeProperty('--banner-bottom'); });
    const top = await page.evaluate(() => document.querySelector('.bottom-sheet')!.getBoundingClientRect().top);
    expect(top).toBeCloseTo(24, 0);
  });
}
