// Plan 5.36 and 5.25 steps 8–9, end to end on staging: join the demo meet, lift the sample, and
// the real judge's lights land on the platform. Only against a running site with its database,
// storage and judge (E2E_BASE_URL); the built site alone has none of them.
import { expect, test } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'needs staging: the database, R2 and the judge');

test('the demo meet: the card, a sample lift, and the judge\'s lights', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'The demo meet' })).toBeVisible();
  await page.getByLabel('Name on your card').fill('E2E lifter');
  await page.getByRole('button', { name: 'Start the demo meet' }).click();

  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByText('Demo meet · Nothing here counts', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SQUAT' })).toBeVisible();
  // a click before the page hydrates does nothing, so click until the stage is up
  await expect(async () => {
    const btn = page.getByRole('button', { name: 'Use a sample lift instead' });
    if (await btn.isVisible()) await btn.click({ timeout: 2000 });
    await expect(page.getByText('Sample lift', { exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText('The judges are looking')).toBeVisible({ timeout: 60_000 });
  // the judge on Render Workflows, then the lights (a close call waits for a referee instead)
  await expect(page.getByRole('heading', { name: /^(Good lift|No lift|Close call)$/ })).toBeVisible({ timeout: 4 * 60_000 });
  const title = await page.getByRole('heading', { name: /^(Good lift|No lift|Close call)$/ }).textContent();
  if (title === 'Close call') await expect(page.getByRole('link', { name: "See the referee's side of this close call" })).toBeVisible();
  else await expect(page.getByRole('button', { name: 'Lift it again' })).toBeVisible();
});
