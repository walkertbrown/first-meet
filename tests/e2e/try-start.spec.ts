// Plan 5.2, step 1: the words on Try a lift's first screen.
import { expect, test } from '@playwright/test';

test('Try a lift opens with its title, both ways in, and the lock line', async ({ page }) => {
  await page.goto('/try');
  await expect(page.getByRole('heading', { name: 'Try a lift' })).toBeVisible();
  await expect(page.getByText('One bodyweight squat. Your phone is the referee.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use my camera' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Watch a sample lift' })).toBeVisible();
  await expect(page.getByText("Your video stays on this phone. It's never uploaded.", { exact: true })).toBeVisible();
});
