// Item 118 (look 9 "The bomb-out clip", look 5.1): under her best lift's clip, "Share" and "Save to my phone" sit side
// by side when the column is 350 px or wider (a 390 px screen) and stack, each full width, "Share" first, 12 px apart, when it's
// narrower; and "Share" keeps its width while it reads "Sharing". The component's own markup and the site's own CSS
// and fonts, laid out in Chromium at the column each phone gives (20 px gutters; 80 px from 1024 up).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const css = readFileSync(join(__dirname, '../../web/app/fonts.css'), 'utf8') + ['globals.css', 'platform.css']
  .map(f => readFileSync(join(__dirname, '../../web/app', f), 'utf8').replace(/@import[^;]+;/g, '')).join('\n');
const markup = execFileSync(process.execPath, ['--import', 'tsx', join(__dirname, 'render-best-lift.mts')], { encoding: 'utf8', env: { ...process.env, TSX_TSCONFIG_PATH: join(__dirname, '../../web/tsconfig.json') } });

// screen width → column width
const COLUMNS: [number, number][] = [[360, 320], [375, 335], [379, 339], [380, 340], [389, 349], [390, 350], [391, 351], [1280, 560]];

test('the bomb-out buttons: side by side from a 350 px column, stacked full width under it, and Share keeps its width while sharing (item 118)', async ({ page }) => {
  await page.goto('/healthz');
  for (const [screen, col] of COLUMNS) {
    await page.setViewportSize({ width: screen, height: 900 });
    await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="margin:0">
      <main style="box-sizing:border-box;width:${screen}px;padding:0 ${screen >= 1024 ? (screen - col) / 2 : 20}px"><div style="width:${col}px">${markup}</div></main></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    for (const busy of [false, true]) {
      const m = await page.evaluate(busy => {
        const l = document.querySelector('.best-actions-in.pair .busy-label')!;
        if (busy) l.setAttribute('data-busy', 'true'); else l.removeAttribute('data-busy');
        const [s, v] = [...document.querySelectorAll('.best-actions-in.pair .btn')].map(e => e.getBoundingClientRect());
        const row = document.querySelector('.best-actions')!.getBoundingClientRect();
        const shown = [...l.children].filter(c => getComputedStyle(c).visibility === 'visible').map(c => c.textContent);
        return { row: { left: row.left, width: row.width }, s: { left: s.left, right: s.right, top: s.top, bottom: s.bottom, width: s.width },
          v: { left: v.left, right: v.right, top: v.top, width: v.width }, shown, wide: document.documentElement.scrollWidth > innerWidth };
      }, busy);
      const at = `${screen} px${busy ? ', sharing' : ''}`;
      expect(m.shown, at).toEqual([busy ? 'Sharing' : 'Share']);
      expect(m.wide, `${at}: nothing past the screen`).toBe(false);
      expect(m.row.width, at).toBeCloseTo(col, 0);
      if (col < 350) {
        expect(m.s.width, `${at}: Share full width`).toBeCloseTo(col, 0);
        expect(m.v.width, `${at}: Save full width`).toBeCloseTo(col, 0);
        expect(m.v.top - m.s.bottom, `${at}: Share first, 12 px between`).toBeCloseTo(12, 0);
      } else {
        expect(m.s.top, `${at}: side by side`).toBeCloseTo(m.v.top, 0);
        expect(m.s.left, `${at}: left-aligned`).toBeCloseTo(m.row.left, 0);
        expect(m.v.left - m.s.right, `${at}: 12 px between`).toBeCloseTo(12, 0);
        expect(m.v.right, `${at}: inside the column`).toBeLessThanOrEqual(m.row.left + col + 0.01);
        // look 9: Share is as wide as "Sharing" (117 px) whichever it reads
        expect(m.s.width, at).toBeGreaterThan(110);
        expect(m.s.width, at).toBeLessThan(125);
      }
    }
  }
});

test('Share is as wide resting as sharing (look 5.1)', async ({ page }) => {
  await page.goto('/healthz');
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body style="margin:0"><div style="width:560px">${markup}</div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const w = await page.evaluate(() => {
    const l = document.querySelector('.busy-label')!;
    const b = l.closest('button')!;
    const rest = b.getBoundingClientRect().width;
    l.setAttribute('data-busy', 'true');
    return { rest, busy: b.getBoundingClientRect().width };
  });
  expect(w.busy).toBe(w.rest);
});
