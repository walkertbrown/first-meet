// Meet night, live (plan 5.6): anyone can open /live. It's Lights down, it names the meet night, and
// the board has its Barbell / Home and age segments and "Find a lifter". Meet control is the host's.
import { expect, test } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'needs a site with a database (staging, or a dev server)');

test('/live: Lights down, the meet night, and the board with its filters', async ({ page }) => {
  await page.goto('/live');
  await expect(page.getByText(/^MEET NIGHT · /)).toBeVisible();
  await expect(page.locator('.lights-down')).toHaveCount(1);
  const board = page.getByRole('region', { name: 'THE BOARD' });
  // the segments are labels: once the board has lifters, their rows say "Open" and "Home" too
  const segment = (s: string) => board.locator('label').filter({ has: page.getByText(s, { exact: true }) });
  for (const s of ['Barbell', 'Home', 'All ages', 'Open', '40–49', '50–59', '60–69', '70+']) await expect(segment(s)).toBeVisible();
  await expect(board.getByPlaceholder('Find a lifter')).toBeVisible();
  await segment('Home').click();
  await expect(board.getByRole('radio', { name: 'Home' })).toBeChecked();
});

test('meet control is for the host and admins', async ({ page }) => {
  const r = await page.goto('/host/control');
  expect(r?.status()).toBe(403);
  const post = await page.request.post('/api/host/control', { form: { do: 'close' }, maxRedirects: 0 });
  expect([401, 403]).toContain(post.status());
});

test('/status: three rows with their lamps, never red, and when it was updated', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'Platform status' })).toBeVisible();
  for (const r of ['Lifting and recording', 'Judging', 'Referee bot']) await expect(page.getByText(r, { exact: true })).toBeVisible();
  await expect(page.locator('.status-rows .mini-lamp')).toHaveCount(3);
  await expect(page.locator('.status-rows .mini-lamp.red')).toHaveCount(0);
  await expect(page.getByText(/^Updated \d+ seconds? ago\.$/)).toBeVisible();
});
