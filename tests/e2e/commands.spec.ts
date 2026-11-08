// Plan piece 2, `commands`, on the real stage with the good sample lift.
import { expect, test, type Page } from '@playwright/test';

type Mark = { text: string; t: number };
declare global { interface Window { __spoken: Mark[]; __shown: Mark[] } }

/** Records each Web Speech call and each command word put on the stage, with the time. */
async function watch(page: Page) {
  await page.addInitScript(() => {
    window.__spoken = [];
    window.__shown = [];
    class U { rate = 1; pitch = 1; volume = 1; constructor(public text: string) {} }
    // Headless Chromium has no voices; a stand-in records what would be said.
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: U, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, speak(u: U) { if (u.text.trim()) window.__spoken.push({ text: u.text, t: performance.now() }); } },
    });
    new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n instanceof HTMLElement && n.matches('.command .c')) window.__shown.push({ text: n.textContent ?? '', t: performance.now() });
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

async function watchSample(page: Page) {
  await page.goto('/try');
  await page.getByRole('button', { name: 'Watch a sample lift' }).click();
}

test('each command is spoken within 300 ms of its trigger', async ({ page }) => {
  await watch(page);
  await watchSample(page);
  // "Rack!" is up for under a second; the marks recorded on the page are read after the call.
  await expect(page.getByRole('heading', { name: 'Good lift' })).toBeVisible({ timeout: 4 * 60_000 });
  const { spoken, shown } = await page.evaluate(() => ({ spoken: window.__spoken, shown: window.__shown }));
  for (const word of ['Good spot.', 'Squat!', 'Rack!']) {
    const s = spoken.find(x => x.text === word);
    const w = shown.find(x => x.text === word);
    expect(s, `"${word}" is spoken`).toBeTruthy();
    expect(w, `"${word}" is shown`).toBeTruthy();
    // The word goes up on the same trigger; the voice must start within 300 ms of it.
    expect(Math.abs(s!.t - w!.t), `"${word}": voice and word apart`).toBeLessThanOrEqual(300);
  }
});

test('with spoken commands off, the words still show', async ({ page }) => {
  await watch(page);
  await watchSample(page);
  await page.getByRole('button', { name: 'Sound on' }).click();
  await expect(page.getByRole('button', { name: 'Sound off' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Good lift' })).toBeVisible({ timeout: 4 * 60_000 });
  const { spoken, shown } = await page.evaluate(() => ({ spoken: window.__spoken, shown: window.__shown }));
  expect(shown.map(x => x.text)).toEqual(expect.arrayContaining(['Good spot.', 'Squat!', 'Rack!']));
  expect(spoken).toEqual([]);
});
