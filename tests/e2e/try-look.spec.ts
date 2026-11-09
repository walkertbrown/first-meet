// LookieBot's phase 1 look check (items 1–9) on a sample lift, at 390 × 844: what shows on
// the stage and the panel, and when (look 4, 6, 7 and 9).
import { expect, test, type Page } from '@playwright/test';

type Mark = { what: string; t: number; media?: number; opacity?: string; name?: string; duration?: string; transform?: string; elapsed?: number; segs?: number };
declare global { interface Window { __marks: Mark[] } }

/** Records the spot segments lighting, "Squat!" going up (and the clip's time then), the clip starting, and REC. */
async function watch(page: Page) {
  await page.addInitScript(() => {
    window.__marks = [];
    const mark = (what: string, extra: Partial<Mark> = {}) => window.__marks.push({ what, t: performance.now(), ...extra });
    const feed = () => document.querySelector<HTMLVideoElement>('.footage video.feed');
    const hooked = new WeakSet<Element>();
    let litLamps = 0;
    new MutationObserver(muts => {
      const v = feed();
      if (v && !hooked.has(v)) { hooked.add(v); v.addEventListener('play', () => mark('play', { media: v.currentTime })); }
      // Each lamp as it lights, however React updates them.
      const n = document.querySelectorAll('.stage .lamps .lamp.white, .stage .lamps .lamp.red').length;
      for (; litLamps < n; litLamps++) mark('lamp');
      for (const m of muts) {
        if (m.type === 'attributes' && m.target instanceof HTMLElement) {
          const el = m.target;
          if (el.matches('.spotparts span.seen') && !(m.oldValue ?? '').includes('seen')) mark(`seen:${el.textContent}`);
          if (el.matches('.stage.recording') && !(m.oldValue ?? '').includes('recording')) mark('recording');
          if (el.matches('.result.on') && !(m.oldValue ?? '').includes(' on')) mark('result');
          if (el.matches('.spill.on') && !(m.oldValue ?? '').includes(' on')) mark('spill');
        }
        for (const n of m.addedNodes) {
          if (n instanceof HTMLElement && n.matches('.command .c')) {
            const text = n.textContent ?? '';
            // Its style the moment it goes up, and the keyframe's own end event: the main thread
            // can be busy judging, so no timers.
            const cs = getComputedStyle(n);
            mark(`shown:${text}`, { segs: document.querySelectorAll('.stage.spotting .spotparts span.seen').length, media: v?.currentTime, opacity: cs.opacity, name: cs.animationName, duration: cs.animationDuration, transform: cs.transform });
            n.addEventListener('animationend', e => mark(`${text}:end`, { opacity: getComputedStyle(n).opacity, name: e.animationName, elapsed: e.elapsedTime }));
          }
        }
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  });
}

const marks = (page: Page) => page.evaluate(() => window.__marks);
const at = (ms: Mark[], what: string) => ms.find(m => m.what === what);

test.use({ viewport: { width: 390, height: 844 } });

test('the sample, motion on: segments, "Squat!" before the clip plays, REC, "Breathe." and the result order', async ({ page }) => {
  await watch(page);
  await page.goto('/try');
  await page.getByRole('button', { name: 'Watch a sample lift' }).click();

  // 5. The segments are there from the start, unlit.
  await expect(page.locator('.stage.spotting')).toBeVisible();
  await expect(page.locator('.spotparts')).toHaveCSS('opacity', '1');
  await expect(page.locator('.spotparts span')).toHaveCount(4);

  // 4. The command fits a 390 px stage: (390 − 40) / 4.6 = 76 px.
  const size = await page.locator('.command').evaluate(el => {
    const s = document.createElement('span');
    s.className = 'c on'; s.textContent = 'Squat!';
    el.appendChild(s);
    const px = parseFloat(getComputedStyle(s).fontSize);
    s.remove();
    return px;
  });
  expect(size).toBeCloseTo(76.1, 0);

  // 7. The held breath's words.
  await expect(page.locator('.breathe')).toContainText("Breathe.Your lights are on their way. You don't need to do anything.", { timeout: 4 * 60_000 });
  // The result is in the page early at opacity 0; .on is when it comes in.
  await expect(page.locator('.result.on')).toContainText('Good lift', { timeout: 60_000 });
  const ms = await marks(page);

  // 5. Lit one by one, head to feet, about 180 ms apart.
  const lit = ['head', 'hips', 'knees', 'feet'].map(p => at(ms, `seen:${p}`));
  for (const m of lit) expect(m).toBeTruthy();
  for (let k = 1; k < 4; k++) expect(lit[k]!.t - lit[k - 1]!.t).toBeGreaterThanOrEqual(150);
  // Look 6 step 2: "Good spot." waits for the fourth's 180 ms, with all four still up and lit;
  // they go when "Stand tall and still." comes, over 160 ms.
  const good = at(ms, 'shown:Good spot.')!;
  expect(good.t - lit[3]!.t).toBeGreaterThanOrEqual(170);
  expect(good.segs).toBe(4);
  expect(at(ms, 'shown:Stand tall and still.')!.segs).toBe(0);
  await expect(page.locator('.spotparts')).toHaveCSS('transition-duration', '0.16s, 0.16s');

  // 2. The clip holds its first frame until "Squat!" is up; then it plays.
  const squat = at(ms, 'shown:Squat!');
  const play = at(ms, 'play');
  expect(squat && play).toBeTruthy();
  expect(squat!.media!).toBeLessThan(0.05);
  expect(play!.t).toBeGreaterThanOrEqual(squat!.t - 1);
  // The 900 ms keyframe runs and leaves the word gone.
  expect(at(ms, 'shown:Squat!')).toMatchObject({ name: 'cmd', duration: '0.9s' });
  expect(at(ms, 'Squat!:end')).toMatchObject({ name: 'cmd', elapsed: 0.9, opacity: '0' });

  // 1. REC starts with "Squat!".
  const rec = at(ms, 'recording');
  expect(rec).toBeTruthy();
  expect(Math.abs(rec!.t - squat!.t)).toBeLessThan(50);

  // NerdCider 1 and look 9 step 9: the spill comes with the third lamp, the result 420 ms after it.
  const lamps = ms.filter(m => m.what === 'lamp');
  expect(lamps).toHaveLength(3);
  expect(lamps[1].t - lamps[0].t).toBeGreaterThanOrEqual(300);
  expect(lamps[2].t - lamps[1].t).toBeGreaterThanOrEqual(300);
  expect(at(ms, 'spill')!.t - lamps[2].t).toBeLessThan(100);
  const res = at(ms, 'result')!.t - lamps[2].t;
  expect(res).toBeGreaterThanOrEqual(400);
  expect(res).toBeLessThan(560);

  // 9. Under the sentence comes in together, 200 ms after the result starts.
  const after = page.locator('.after');
  await expect(after).toHaveCSS('animation-delay', '0.2s');
  await expect(after).toHaveCSS('animation-duration', '0.26s');
  await expect(after).toHaveCSS('opacity', '1');

  // REC holds its last second through the fade-out, not "REC 0:00".
  await expect(page.locator('.stage .rec')).toHaveCSS('opacity', '0');
  await expect(page.locator('.stage .rec span')).toHaveText(/^REC 0:(0[1-9]|[1-5]\d)$/);
  // Look 4: the meet line's date never breaks.
  await expect(page.locator('.result strong, .after strong').first()).toContainText('Feb\u00A026\u2060–\u206027');
});

test('the sample, motion off: "Squat!" is up 900 ms, with no scale, and the result comes all at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await watch(page);
  await page.goto('/try');
  await page.getByRole('button', { name: 'Watch a sample lift' }).click();
  await expect(page.locator('.result.on')).toContainText('Good lift', { timeout: 4 * 60_000 });
  const ms = await marks(page);
  // Up at once, for 900 ms, with no scale or fade, then gone.
  expect(at(ms, 'shown:Squat!')).toMatchObject({ name: 'cmd-still', duration: '0.9s', opacity: '1', transform: 'none' });
  expect(at(ms, 'Squat!:end')).toMatchObject({ name: 'cmd-still', elapsed: 0.9, opacity: '0' });
  const squat = at(ms, 'shown:Squat!'), play = at(ms, 'play');
  expect(squat!.media!).toBeLessThan(0.05);
  expect(play!.t).toBeGreaterThanOrEqual(squat!.t - 1);
  await expect(page.locator('.after')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.after')).toHaveCSS('opacity', '1');
});

test('the panel scrolls with a thin ink-3 scrollbar', async ({ page }) => {
  await page.goto('/try');
  await page.getByRole('button', { name: 'Watch a sample lift' }).click();
  const panel = page.locator('.try-stagecol .panel');
  await expect(panel).toHaveCSS('scrollbar-width', 'thin');
  const ink3 = await page.evaluate(() => {
    const p = document.createElement('p');
    p.style.color = 'var(--ink-3)';
    document.body.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  });
  expect(await panel.evaluate(el => getComputedStyle(el).scrollbarColor)).toContain(ink3);
});

test('a no-rep keeps the three lamps on the stage', async ({ page }) => {
  await page.goto('/try');
  // A no-rep needs 20 s with no squat, which the sample never gives, so the stage's own CSS is checked.
  const opacity = await page.evaluate(() => {
    const stage = document.createElement('div');
    stage.className = 'stage norep';
    const lamps = document.createElement('div');
    lamps.className = 'lamps';
    stage.appendChild(lamps);
    document.body.appendChild(stage);
    const o = getComputedStyle(lamps).opacity;
    stage.remove();
    return o;
  });
  expect(opacity).toBe('1');
});
