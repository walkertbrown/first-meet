// The sample meet (plan 5.3, piece 22): linked from the landing page; every chapter can be jumped to
// and shows its scene; Play runs the 90 s through to the end actions. Made-up lifters only: the data's
// names are checked in tests/unit/sample-meet.test.ts.
import { expect, test } from '@playwright/test';

test('the landing page links to the sample meet', async ({ page }) => {
  await page.goto('/');
  await page.locator('a[href="/sample"]').first().click();
  await expect(page).toHaveURL(/\/sample$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('A meet night, start to finish');
  await expect(page.getByText('SAMPLE MEET · MADE-UP LIFTERS')).toBeVisible();
});

test('every chapter can be jumped to, and shows its scene', async ({ page }) => {
  await page.goto('/sample');
  const scene = page.locator('.scene');
  const chapter = (name: RegExp) => page.locator('.chapters button').filter({ hasText: name });

  await expect(scene).toContainText('THE PLATFORM IS OPEN');
  await expect(scene.locator('.num')).toHaveText('0');

  await chapter(/lights land/i).click();
  await expect(chapter(/lights land/i)).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('.replay-time')).toHaveText('0:10 / 1:30');

  await chapter(/close call/i).click();
  await expect(chapter(/close call/i)).toHaveAttribute('aria-current', 'step');

  await chapter(/meet night/i).click();
  await expect(scene.getByRole('img', { name: /host desk/i })).toBeVisible();

  await chapter(/her card/i).click();
  await expect(scene.getByRole('img', { name: /Dana W\.'s meet card/ })).toBeVisible();
});

test('Play runs the 90 seconds through every chapter to the end actions', async ({ page }) => {
  await page.clock.install();
  await page.goto('/sample');
  await page.getByRole('button', { name: 'Play' }).click();

  await page.clock.runFor(16_000);
  await expect(page.locator('.scene .hud-label')).toHaveText(/ · \d OF 3$/);
  await expect(page.locator('.ticker li').first()).toBeVisible();

  await page.clock.runFor(23_000);
  await expect(page.locator('.scene')).toContainText('The referee bot is looking at this one');
  await page.clock.runFor(6_000);
  await expect(page.locator('.scene')).toContainText('2 white lights and 1 red: good lift.');

  await page.clock.runFor(50_000);
  await expect(page.locator('.replay-time')).toHaveText('1:30 / 1:30');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  const end = page.locator('.scene-end');
  await expect(end.getByRole('link', { name: 'Try a lift' })).toHaveAttribute('href', '/try');
  await expect(end.getByRole('link', { name: 'Join the Winter meet' })).toHaveAttribute('href', '/join');
  await expect(end.getByRole('link', { name: 'Try the host desk' })).toHaveAttribute('href', '/host/sample');
  await expect(end).toContainText("In a real meet, Soo's live plays here from YouTube.");
  await expect(page.locator('.board tbody tr').first()).toBeVisible();
});
