// Her first-screen buttons work when they're tapped before the page's script has run (The Playner, Nov 28,
// after CI on 0bfa627 caught a tap on "Save my openers" that did nothing). A button that can be plain HTML
// is (a link or a form), and works with no script at all. One that needs the page (the camera, the
// clipboard, the platform's steps) keeps the tap and sends it once the page runs (web/lib/early-taps.ts):
// those tests hold the page's scripts back, tap, then let them through.
import { expect, test, type Locator, type Page } from '@playwright/test';

const staging = !!process.env.E2E_BASE_URL;

/** No script of the app's own runs: the page is exactly the HTML the server sent. */
async function noScripts(page: Page) {
  await page.route(/\/_next\/static\/.*\.js(\?|$)/, r => r.abort());
}

/** The page's scripts wait until release(): taps until then land before the page runs. */
async function holdScripts(page: Page) {
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  await page.route(/\/_next\/static\/.*\.js(\?|$)/, async r => { await held; await r.continue().catch(() => {}); });
  return async () => { release(); await page.unrouteAll({ behavior: 'ignoreErrors' }); };
}

/** Tapped before the page runs: held at look 5.1's loading fill, not disabled, then sent once it runs. */
async function tapEarly(page: Page, button: Locator, release: () => Promise<void>) {
  await expect(button, 'never shown disabled before the page runs').toBeEnabled();
  await button.click();
  await expect(button).toHaveAttribute('data-early-held', '');
  await expect(button).toHaveCSS('opacity', '0.85');
  await release();
}

async function signInInMeetWeek(page: Page) {
  await page.goto('/signin/test');
  await page.getByRole('button', { name: 'Sign in as a test lifter in meet week', exact: true }).click();
  await expect(page).toHaveURL(/\/meet-week$/, { timeout: 60_000 });
}

test('"Use my camera" on /try, tapped before the page runs, opens "Find your spot" once it does (5.1)', async ({ page }) => {
  const release = await holdScripts(page);
  await page.goto('/try', { waitUntil: 'commit' });
  await tapEarly(page, page.getByRole('button', { name: 'Use my camera' }), release);
  await expect(page.getByRole('heading', { name: 'Find your spot' })).toBeVisible({ timeout: 60_000 });
});

test('"Watch a sample lift" on /try, tapped before the page runs, plays the sample once it does (5.1)', async ({ page }) => {
  const release = await holdScripts(page);
  await page.goto('/try', { waitUntil: 'commit' });
  await tapEarly(page, page.getByRole('button', { name: 'Watch a sample lift' }), release);
  await expect(page.getByRole('button', { name: 'Use my camera' })).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('video.feed[src*="/samples/"]')).toBeAttached();
});

test('"Save my openers" tapped before the page runs saves the opener she picked (5.23)', async ({ browser }) => {
  test.skip(!staging, 'needs staging: the database and the test sign-in');
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

test('"Copy my corner link" tapped before the page runs copies it, or shows it, once the page runs (5.23)', async ({ browser }) => {
  test.skip(!staging, 'needs staging: the database and the test sign-in');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await signInInMeetWeek(page);
  const release = await holdScripts(page);
  await page.goto('/meet-week', { waitUntil: 'commit' });
  await tapEarly(page, page.getByRole('button', { name: 'Copy my corner link' }), release);
  // the browser may no longer count her tap by the time the page runs: then the link is shown to copy by hand
  await expect(async () => {
    const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    const shown = await page.locator('.mw-link').textContent({ timeout: 500 }).catch(() => '');
    expect(`${copied} ${shown}`).toMatch(/\/corner\/[\w-]+/);
  }).toPass({ timeout: 60_000 });
  await ctx.close();
});

test('the demo welcome sheet\'s "Go to the platform", tapped before the page runs, closes it once it does (5.36)', async ({ page }) => {
  test.skip(!staging, 'needs staging: the database');
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Start the demo meet' }).click();
  await expect(page).toHaveURL(/\/platform\?welcome=1$/, { timeout: 60_000 });
  const release = await holdScripts(page);
  await page.reload({ waitUntil: 'commit' });
  const sheet = page.getByRole('dialog');
  await tapEarly(page, sheet.getByRole('button', { name: 'Go to the platform' }), release);
  await expect(sheet).toBeHidden({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/platform$/, { timeout: 60_000 });
});
