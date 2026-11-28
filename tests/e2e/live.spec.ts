// Meet night, live (plan 5.6): anyone can open /live. It's Lights down, it names the meet night, and
// the board has its Barbell / Home and age segments and "Find a lifter". Meet control is the host's.
import { expect, test } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'needs a site with a database (staging, or a dev server)');

test('/live: Lights down, the meet night, and the board with its filters', async ({ page }) => {
  await page.goto('/live');
  await expect(page.getByText(/^MEET NIGHT · /)).toBeVisible();
  await expect(page.locator('.lights-down')).toHaveCount(1);
  const board = page.getByRole('region', { name: 'THE BOARD' });
  for (const s of ['Barbell', 'Home', 'All ages', 'Open', '40–49', '50–59', '60–69', '70+']) await expect(board.getByText(s, { exact: true })).toBeVisible();
  await expect(board.getByPlaceholder('Find a lifter')).toBeVisible();
  await board.getByText('Home', { exact: true }).click();
  await expect(board.getByRole('radio', { name: 'Home' })).toBeChecked();
});

test('meet control is for the host and admins', async ({ page }) => {
  const r = await page.goto('/host/control');
  expect(r?.status()).toBe(403);
  const post = await page.request.post('/api/host/control', { form: { do: 'close' }, maxRedirects: 0 });
  expect([401, 403]).toContain(post.status());
});
