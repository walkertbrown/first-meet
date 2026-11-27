// Phase 4 "Done when" (3.4d steps 7 and 14): on staging, with "Referee bot test answers" set to "No key", the next
// close call goes to the bot even while REFEREE_BOT is off, and gets three white lights and "The referee bot couldn't
// look at this one, so it counts.", and /ops shows "Referee bot not running: no key".
// The demo meet has no bench sample (its bench stands in the squat's good lift, judged as a squat), so the close call
// here is the demo's squat 3. The bench takes the same path in enqueue, and tests/db/referee-bot.test.ts checks the
// bench itself. The answer is set from /ops's own form, just before squat 3, so it goes to her close call and never to
// one already waiting for the test referee.
import { expect, test, type Browser, type Page } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'needs staging: the database, R2, the judge and the test admin');

const LIGHTS = /^(Good lift|No lift|Close call)$/;
const UNAVAILABLE = "The referee bot couldn't look at this one, so it counts.";

async function admin(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/signin/test');
  await page.getByRole('button', { name: 'Sign in as the test admin' }).click();
  await expect(page).toHaveURL(/\/ops$/);
  return page;
}

/** "Referee bot test answers" on /ops: pick one, "Use for the next job". */
async function testAnswers(ops: Page, label: 'No key' | 'Real') {
  await ops.goto('/ops');
  const set = ops.getByRole('group', { name: 'Referee bot test answers' });
  await set.getByLabel(label, { exact: true }).check();
  await ops.getByRole('button', { name: 'Use for the next job' }).click();
  await expect(ops).toHaveURL(/\/ops$/);
  await expect(ops.getByRole('group', { name: 'Referee bot test answers' }).getByLabel(label, { exact: true })).toBeChecked();
}

async function joinDemo(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await page.getByLabel('Name on your card').fill('E2E lifter');
  await page.getByRole('button', { name: 'Start the demo meet' }).click();
  await expect(page).toHaveURL(/\/platform\?welcome=1$/);
  const welcome = page.getByRole('dialog', { name: 'Welcome to the demo meet' });
  await expect(async () => {
    if (await welcome.isVisible()) await welcome.getByRole('button', { name: 'Go to the platform' }).click({ timeout: 2000 });
    await expect(welcome).toBeHidden({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}

async function liftSample(page: Page) {
  await expect(async () => {
    const btn = page.getByRole('button', { name: 'Use a sample lift instead' });
    if (await btn.isVisible()) await btn.click({ timeout: 2000 });
    await expect(page.getByText('Sample lift', { exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.locator('.result.on h2', { hasText: LIGHTS })).toBeVisible({ timeout: 5 * 60_000 });
}

async function declareNext(page: Page, next: number) {
  await page.getByRole('button', { name: 'Declare your next attempt' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.locator('.try-actions .btn').click();
  await sheet.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('article', { name: new RegExp(`^Squat, Attempt ${next} of 3`, 'i') })).toBeVisible({ timeout: 30_000 });
}

test('"No key" on staging: the next close call gets three whites and the line, and /ops says the bot is not running', async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  const ops = await admin(browser);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await joinDemo(page);
    // squat 1 and 2 (good lift, no lift), then the answer, then squat 3: the close call
    for (const next of [2, 3]) {
      await liftSample(page);
      await declareNext(page, next);
    }
    await testAnswers(ops, 'No key');
    await liftSample(page);
    // the bot couldn't look: three white lights, a good lift, and the line
    await expect(page.locator('.result.on h2', { hasText: 'Good lift' })).toBeVisible({ timeout: 3 * 60_000 });
    await expect(page.locator('.stage .lamps .lamp.white')).toHaveCount(3);
    await expect(page.locator('.stage .lamps .lamp.red')).toHaveCount(0);
    await expect(page.getByText(UNAVAILABLE, { exact: true })).toBeVisible();
    // it stays after a reload: it's what was saved
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Good lift' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(UNAVAILABLE, { exact: true })).toBeVisible();
    // the answer was used up, and /ops has the red line
    await ops.goto('/ops');
    await expect(ops.getByText(/^Referee bot not running: no key$/)).toBeVisible();
    await expect(ops.getByRole('group', { name: 'Referee bot test answers' }).getByLabel('Real', { exact: true })).toBeChecked();
  } finally {
    // never leave the answer set for the next close call on staging
    await testAnswers(ops, 'Real').catch(() => undefined);
    await ctx.close();
    await ops.context().close();
  }
});
