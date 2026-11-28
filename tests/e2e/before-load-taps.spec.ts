// Her first-screen buttons work when they're tapped before the page's script has run (The Playner, Nov 28,
// after CI on 0bfa627 caught a tap on "Save my openers" that did nothing). Each test blocks the page's
// scripts, so every tap here lands before the page could run: what works is plain HTML (a link or a form).
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'needs staging: the database and the test sign-in');

/** No script of the app's own runs: the page is exactly the HTML the server sent. */
async function noScripts(page: Page) {
  await page.route(/\/_next\/static\/.*\.js(\?|$)/, r => r.abort());
}

async function signInInMeetWeek(page: Page) {
  await page.goto('/signin/test');
  await page.getByRole('button', { name: 'Sign in as a test lifter in meet week', exact: true }).click();
  await expect(page).toHaveURL(/\/meet-week$/, { timeout: 60_000 });
}

test('"Save my openers" tapped before the page runs saves the opener she picked (5.23)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await signInInMeetWeek(page);
  await noScripts(page);
  await page.goto('/meet-week');
  const save = page.getByRole('button', { name: 'Save my openers' });
  await expect(save, 'never shown disabled before the page runs').toBeEnabled();
  // a lighter opener than the suggested one, on the first lift she can still change
  const radios = page.locator('fieldset.choices:not([disabled])').first().locator('input[type=radio]');
  expect(await radios.count()).toBeGreaterThan(1);
  const lighter = radios.nth(1);
  const picked = await lighter.getAttribute('value');
  const name = await lighter.getAttribute('name');
  await lighter.check({ force: true });
  await save.click();
  await expect(page).toHaveURL(/\/meet-week$/);
  await expect(page.getByRole('status').filter({ hasText: 'Openers saved. You can change them until you lift.' })).toBeVisible();
  await expect(page.locator(`input[type=radio][name="${name}"][value="${picked}"]`)).toBeChecked();

  // with the page running again, the opener she saved is the one shown
  await page.unrouteAll();
  await page.reload();
  await expect(page.locator(`input[type=radio][name="${name}"][value="${picked}"]`)).toBeChecked();
  await ctx.close();
});
