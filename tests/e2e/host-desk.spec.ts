// The demo host desk (plan 5.35 piece 12, 5.36): a demo lifter who has totaled is on /host/sample's
// Read list at once. "Read" puts her sheet on her phone within 5 s; her name crossing the roll call's
// middle puts the banner on her phone within 5 s. With reduced motion the roll call pages instead, and
// every name on a page counts as crossed.
import { expect, test, type Browser, type Page } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'needs a site with a database and the test sign-in (staging, or a dev server)');

async function demoPhone(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await ctx.newPage();
  await phone.goto('/signin/test');
  await phone.getByRole('button', { name: 'Sign in as a demo lifter who has totaled' }).click();
  await expect(phone).toHaveURL(/\/platform\/total$/);
  await expect(phone.getByRole('link', { name: 'Read your own name on the host desk' })).toHaveAttribute('href', '/host/sample');
  return phone;
}

async function desk(browser: Browser, reducedMotion: 'reduce' | 'no-preference') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion });
  const page = await ctx.newPage();
  await page.goto('/host/sample');
  await expect(page.getByText('Sample meet · Meet night')).toBeVisible();
  return page;
}

test("Read puts her sheet on her phone, and her name crossing puts the banner there, each within 5 s", async ({ browser }) => {
  test.setTimeout(3 * 60_000);
  const phone = await demoPhone(browser);
  const d = await desk(browser, 'no-preference');

  // she is the newest demo total: first on the Read list, and first in the roll call
  await expect(d.locator('.desk-card').first()).toContainText('FIRST TOTALS');
  await expect(d.locator('.desk-card').first()).toContainText('Test');
  const herId = await d.locator('.roll-strip .roll-entry').first().getAttribute('data-id');
  expect(herId).toBeTruthy();

  // the roll call's crossing for her, whenever it comes
  const crossed = d.waitForRequest(r => r.url().endsWith('/api/host/sample/crossed') && (r.postData() ?? '').includes(herId!), { timeout: 90_000 });

  await d.getByRole('button', { name: 'Read', exact: true }).click();
  const sheet = phone.getByRole('dialog');
  await expect(sheet).toContainText('SAMPLE MEET NIGHT', { timeout: 5000 });
  await expect(sheet).toContainText('Your name was read on the sample meet night', { timeout: 5000 });
  await expect(sheet).not.toContainText('Soo');
  await expect(sheet.getByRole('link', { name: 'Watch the moment' })).toHaveCount(0);
  await phone.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await crossed;
  const banner = phone.locator('.soo-banner');
  await expect(banner).toContainText('Your name crossed the sample meet night.', { timeout: 5000 });
  await expect(banner).not.toContainText('Soo');
});

test('with reduced motion the roll call pages, and the names on a page count as crossed', async ({ browser }) => {
  test.setTimeout(2 * 60_000);
  const phone = await demoPhone(browser);
  const d = await desk(browser, 'reduce');
  await expect(d.locator('.roll-page').first()).toBeVisible();
  await expect(d.locator('.roll-strip')).toHaveCount(0);
  await expect(phone.locator('.soo-banner')).toContainText('Your name crossed the sample meet night.', { timeout: 5000 + 2000 });
});

test('Space reads, S skips, and Hide keys hides the bar and the key line', async ({ browser }) => {
  const d = await desk(browser, 'no-preference');
  const left = d.locator('.desk-left');
  const before = Number((await left.textContent())!.split(' ')[0]);
  await d.keyboard.press('s');
  await expect(left).toHaveText(`${before - 1} left in this list`);
  await expect(d.getByText('Space Read · S Skip · P Pause')).toBeVisible();
  await d.getByLabel('Hide keys').check();
  await expect(d.getByText('Space Read · S Skip · P Pause')).toBeHidden();
  await expect(d.getByRole('button', { name: 'Slower' })).toBeHidden();
  await d.reload();
  await expect(d.getByLabel('Hide keys')).toBeChecked();
  await expect(d.getByRole('button', { name: 'Faster' })).toBeHidden();
});
