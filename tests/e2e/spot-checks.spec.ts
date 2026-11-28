// Phase 5 "Done when" (item 104), on staging: in a test meet past its clip deadline, each group's top 3 gets a
// spot check; with "Spot check: weight not visible on attempt 1", her attempt 1 turns red, her total and her
// page's line change, the 4th moves into the top 3 and gets one, and "Make the board final" stays off until
// every check is done; "Checked" by the test referee undoes the red. Then the board is made final, and
// /results shows "Checked by a referee" under the top 3.
// The scene is staging's "Give the test meet five Barbell totals past its clip deadline": the meet-week test
// lifter at 580 kg with squat 1 her only good squat, and Ada 540, Bea 510, Cleo 480, Dot 450. REFEREE_BOT is
// off on staging, so only the test answer's job goes to the bot (its frames from the real worker), and the
// others wait for a person.
import { expect, test, type Browser, type Page } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'needs staging: the database, R2, the frames worker and the test accounts');

const step = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);
const SCENE = 'Give the test meet five Barbell totals past its clip deadline';
const BOT_RED = 'Referee bot: weight not visible on Squat 1.';
const TOTAL_LINE = 'A spot check found a problem with your Squat 1, so your total changed.';

async function notEdgeCheck(p: Page) {
  await p.waitForLoadState('load');
  if (await p.getByText('Performing security verification', { exact: false }).count()) {
    throw new Error("Render's edge bot check (Cloudflare) answered instead of the app; wait a while before running this again");
  }
}

async function signedIn(browser: Browser, button: string, url: RegExp, phone = false) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 } } : { viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('/signin/test');
  await notEdgeCheck(page);
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page).toHaveURL(url);
  return page;
}

const row = (desk: Page, place: string | RegExp) => desk.locator('article.spot-lifter').filter({ has: desk.locator('.spot-place', { hasText: place }) });
const finalButton = (control: Page) => control.getByRole('button', { name: 'Make the board final', exact: true }).first();

test('spot checks: the bot reds her squat 1, the 4th moves in, the board waits, and Checked puts her back', async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  // she and her flightmates in the test meet
  const her = await signedIn(browser, 'Sign in as a test lifter in meet week', /\/meet-week$/, true);
  const admin = await signedIn(browser, 'Sign in as the test admin', /\/ops$/);
  const desk = await signedIn(browser, 'Sign in as the test referee', /\/referee/);

  // the test answer first: the scene's deadline has passed, so the bot's tick makes the checks within seconds
  const set = admin.getByRole('group', { name: 'Referee bot test answers' });
  await set.getByLabel('Spot check: weight not visible on attempt 1', { exact: true }).check();
  await admin.getByRole('button', { name: 'Use for the next job' }).click();
  await expect(admin.getByRole('group', { name: 'Referee bot test answers' }).getByLabel('Spot check: weight not visible on attempt 1', { exact: true })).toBeChecked();
  await admin.goto('/signin/test');
  await admin.getByRole('button', { name: SCENE, exact: true }).click();
  await expect(admin).toHaveURL(/\/host\/control/);
  await expect(admin.getByText('Test meet (test meet)')).toBeVisible();
  await expect(finalButton(admin)).toBeDisabled();
  step('scene set');

  // her total before: 580 kg
  await her.goto('/platform/total');
  await notEdgeCheck(her);
  await expect(her.getByText(TOTAL_LINE)).toHaveCount(0);

  // the top 3 each get a check: hers goes to the bot, the other two wait for a person
  await desk.goto('/referee/spot');
  await expect(desk.locator('article.spot-lifter')).toHaveCount(3, { timeout: 60_000 });
  await expect(row(desk, '1st · 580 kg')).toBeVisible();
  await expect(row(desk, '2nd · 540 kg').getByText('Waiting for a referee.')).toBeVisible();
  await expect(desk.getByText('Ada Test')).toHaveCount(0);

  // the bot's answer lands: frames from the worker, then the faked answer
  await expect(async () => {
    await desk.reload();
    await expect(desk.getByText(BOT_RED)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 10 * 60_000, intervals: [10_000] });
  step('bot red landed');

  // her squat 1 red leaves her with no total; she stays on the desk below the new top 3, and Cleo moves in
  const held = row(desk, 'No total');
  await expect(held.getByText(BOT_RED)).toBeVisible();
  await expect(held.getByRole('img', { name: 'Red light' })).toHaveCount(3); // squat 1 (spot), squats 2 and 3 (depth)
  await expect(row(desk, '3rd · 480 kg')).toBeVisible();
  await expect(row(desk, '3rd · 480 kg').getByText('Waiting for a referee.')).toBeVisible();
  await expect(desk.locator('article.spot-lifter')).toHaveCount(4);

  // her page's line
  await her.goto('/platform/total');
  await expect(her.getByText(TOTAL_LINE)).toBeVisible();
  step('her line shown');

  // the board waits while the 4th's check (and Ada's, Bea's) wait
  await admin.goto('/host/control');
  await expect(finalButton(admin)).toBeDisabled();

  // the test referee's "Checked" puts her back: 1st at 580 kg, and her line goes
  // staging's one small web instance answers the save and then the desk's refresh (its spot tick and 36 clip
  // links): as the desk's first look, a minute
  await held.getByRole('button', { name: 'Checked', exact: true }).click();
  await expect(row(desk, '1st · 580 kg')).toBeVisible({ timeout: 60_000 });
  await expect(row(desk, '1st · 580 kg').getByRole('button', { name: 'Checked', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(desk.locator('article.spot-lifter')).toHaveCount(3);
  await her.goto('/platform/total');
  await expect(her.getByText(TOTAL_LINE)).toHaveCount(0);
  step('Checked undid the red');

  await admin.goto('/host/control');
  await expect(finalButton(admin)).toBeDisabled();
  for (const place of ['2nd · 540 kg', '3rd · 510 kg']) {
    const r = row(desk, place);
    await r.getByRole('button', { name: 'Checked', exact: true }).click();
    await expect(r.getByRole('button', { name: 'Checked', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
  }
  await expect(desk.getByText('0 to check · 3 checked')).toBeVisible();

  // every check done: the board can be made final
  await admin.goto('/host/control');
  await expect(finalButton(admin)).toBeEnabled();
  await finalButton(admin).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Make the board final', exact: true }).click();
  await expect(admin.getByText('The board is final. Results and awards are public.')).toBeVisible({ timeout: 15_000 });
  step('board final');

  // 5.31: the results, with the referee's line under each of the top 3, and her row card
  await her.goto('/results/test');
  await notEdgeCheck(her);
  await expect(her.getByRole('heading', { name: 'Test meet · final results' })).toBeVisible();
  await expect(her.getByText('1st of 5 in Barbell · Open')).toBeVisible();
  await expect(her.getByText('Checked by a referee')).toHaveCount(3);
  await desk.goto('/referee/spot');
  await expect(row(desk, '1st · 580 kg').getByRole('button', { name: 'Checked', exact: true })).toBeDisabled();
});
