// Piece 7 on staging (NerdCider at e0e2353): her clip runs once when her result settles, even when it
// settles with no new lights. A test-meet lifter lifts squat 1 on her own camera (the stand-in), the
// platform closes before she lifts again ("Close the test meet's platform now"), and the bomb-out's
// best lift gets its clip: made, and played from /api/me/best-lift/clip.mp4.
// The test meet has no sample lift and the stand-in camera has only squat footage, so the seven good
// lifts of a total can't be lifted here; the total goes through the same queue (tests/db/clip.test.ts).
import { expect, test, type Page } from '@playwright/test';
import { fakeCamera } from './fake-camera';

test.skip(!process.env.E2E_BASE_URL, 'needs staging: the database, R2, the judge and the test meet');

const LIGHTS = /^(Good lift|No lift|Close call)$/;
const step = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

async function notEdgeCheck(p: Page) {
  await p.waitForLoadState('load');
  if (await p.getByText('Performing security verification', { exact: false }).count()) {
    throw new Error("Render's edge bot check (Cloudflare) answered instead of the app; wait a while before running this again");
  }
}

async function testButton(page: Page, name: string) {
  await page.goto('/signin/test');
  await notEdgeCheck(page);
  await page.getByRole('button', { name, exact: true }).click();
}

test('the platform closes after her squat 1: her best lift\'s clip is made with no new lights', async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await fakeCamera(page, '/samples/good-lift-wabba.mp4');

  await testButton(page, 'Sign in as a test lifter in meet week');
  await expect(page).toHaveURL(/\/meet-week$/);
  // CI on 0bfa627: a tap before the page is hydrated does nothing (no error, no save), so tap until it's saved
  const savedLine = page.getByRole('status').filter({ hasText: 'Openers saved' });
  await expect(async () => {
    const btn = page.getByRole('button', { name: 'Save my openers' });
    if (await btn.isVisible() && await btn.isEnabled()) await btn.click({ timeout: 2000 });
    await expect(savedLine).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60_000 });
  await testButton(page, "Open the test meet's platform now");
  await expect(page).toHaveURL(/\/platform$/);
  step('platform open');

  await expect(async () => {
    const btn = page.getByRole('button', { name: "I'm ready" });
    if (await btn.isVisible()) await btn.click({ timeout: 2000 });
    await expect(page.locator('.stage')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  const lights = page.getByRole('heading', { name: LIGHTS });
  await expect(lights).toBeVisible({ timeout: 8 * 60_000 });
  const call = await lights.textContent();
  step(`squat 1: ${call}`);
  // a stand-in camera can be hard to see; only a good lift leaves her a best lift to clip
  expect(call, 'squat 1 needs a good lift for a bomb-out with a best lift').toBe('Good lift');

  await testButton(page, "Close the test meet's platform now");
  step('platform closed');
  const r0 = await page.request.get('/api/me/best-lift');
  expect(r0.ok()).toBe(true);

  // about a minute: the close queued it (the card's read, or the dispatcher's sweep within a minute)
  await expect(async () => {
    const r = await page.request.get('/api/me/best-lift');
    const j = await r.json() as { ready?: boolean; failed?: string | null };
    expect(j.failed ?? null).toBeNull();
    expect(j.ready).toBe(true);
  }).toPass({ timeout: 6 * 60_000, intervals: [8000] });
  step('clip made');

  const mp4 = await page.request.get('/api/me/best-lift/clip.mp4');
  expect(mp4.status()).toBe(200);
  expect(mp4.headers()['content-type']).toContain('video/mp4');
  expect((await mp4.body()).length).toBeGreaterThan(50_000);

  await page.goto('/platform/total');
  await notEdgeCheck(page);
  await expect(page.getByText('YOUR BEST LIFT', { exact: false })).toBeVisible();
  await expect(page.getByText('Your clip is being made', { exact: false })).toHaveCount(0);
  await ctx.close();
});
