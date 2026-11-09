// Try a lift with her camera (plan 5.2), and "Save my clip". The camera is a stand-in:
// the good sample lift drawn to a canvas stream. She stands still on its first frame
// until "Squat!" shows, then squats, and stays on the last frame after, as a woman in
// her spot would.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fakeCamera } from './fake-camera';

declare global { interface Window { __shared: { name: string; type: string; size: number }[] } }

async function liftWithCamera(page: Page) {
  await page.goto('/try');
  await page.getByRole('button', { name: 'Use my camera' }).click();
  await page.getByRole('button', { name: 'Open the camera' }).click();
  await expect(page.getByRole('heading', { name: 'Good lift' })).toBeVisible({ timeout: 4 * 60_000 });
}

/** The saved clip's size, read by the browser. */
async function videoSize(page: Page, bytes: Buffer, type: string) {
  return page.evaluate(async ({ b64, type }) => {
    const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    const v = document.createElement('video');
    v.src = URL.createObjectURL(new Blob([bin], { type }));
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; });
    return { w: v.videoWidth, h: v.videoHeight };
  }, { b64: bytes.toString('base64'), type });
}

test('her camera: a good lift, and "Save my clip" downloads a 9:16 video where sharing files isn\'t supported', async ({ page }) => {
  await fakeCamera(page);
  await liftWithCamera(page);
  const save = page.getByRole('button', { name: 'Save my clip' });
  await expect(save).toBeEnabled({ timeout: 60_000 });
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await save.click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/\.(webm|mp4)$/);
  await expect(page.getByRole('button', { name: 'Clip saved' })).toBeVisible();
  const path = await d.path();
  const bytes = readFileSync(path);
  expect(bytes.length).toBeGreaterThan(20_000);
  const { w, h } = await videoSize(page, bytes, d.suggestedFilename().endsWith('mp4') ? 'video/mp4' : 'video/webm');
  expect(w / h).toBeCloseTo(9 / 16, 2);
});

test('"Save my clip" opens the share sheet with the file where it can', async ({ page }) => {
  await page.addInitScript(() => {
    window.__shared = [];
    Object.assign(navigator, {
      canShare: (d: ShareData) => !!d.files?.length,
      share: async (d: ShareData) => { for (const f of d.files ?? []) window.__shared.push({ name: f.name, type: f.type, size: f.size }); },
    });
  });
  await fakeCamera(page);
  await liftWithCamera(page);
  const save = page.getByRole('button', { name: 'Save my clip' });
  await expect(save).toBeEnabled({ timeout: 60_000 });
  await save.click();
  await expect(page.getByRole('button', { name: 'Clip saved' })).toBeVisible({ timeout: 120_000 });
  const shared = await page.evaluate(() => window.__shared);
  expect(shared).toHaveLength(1);
  expect(shared[0].type).toMatch(/^video\/(webm|mp4)/);
  expect(shared[0].size).toBeGreaterThan(20_000);
});
