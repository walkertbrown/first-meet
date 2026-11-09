// Plan 5.36 and 5.25 steps 8–9, end to end on staging: join the demo meet, lift the sample, and
// the real judge's lights land on the platform. Only against a running site with its database,
// storage and judge (E2E_BASE_URL); the built site alone has none of them.
import { expect, test, type Page } from '@playwright/test';
import { fakeCamera } from './fake-camera';

test.skip(!process.env.E2E_BASE_URL, 'needs staging: the database, R2 and the judge');

async function joinDemo(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'The demo meet' })).toBeVisible();
  await page.getByLabel('Name on your card').fill('E2E lifter');
  await page.getByRole('button', { name: 'Start the demo meet' }).click();
  await expect(page).toHaveURL(/\/platform$/);
}

const LIGHTS = /^(Good lift|No lift|Close call)$/;

test('the demo meet: the card, a sample lift, and the judge\'s lights', async ({ page }) => {
  await joinDemo(page);
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

// The stage's beats on a sample lift, timed in the page (MutationObserver, never timers): when
// each command first shows, when "RACK!" clears, and when the frozen (judged) frame shows.
type Beats = { cmd: Record<string, number>; rackOff?: number; frozenAt?: number };
async function watchBeats(page: Page) {
  await page.addInitScript(() => {
    const b: { cmd: Record<string, number>; rackOff?: number; frozenAt?: number } = { cmd: {} };
    (window as unknown as { __beats: typeof b }).__beats = b;
    new MutationObserver(() => {
      const now = performance.now();
      const words = [...document.querySelectorAll('.command .c')].map(el => el.textContent ?? '');
      for (const t of words) if (t && !(t in b.cmd)) b.cmd[t] = now;
      if ('RACK!' in b.cmd && b.rackOff === undefined && !words.includes('RACK!')) b.rackOff = now;
      const frozen = document.querySelector('canvas.feed');
      if (b.frozenAt === undefined && frozen && !frozen.hasAttribute('hidden')) b.frozenAt = now;
    }).observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  });
}
async function liftSample(page: Page): Promise<Beats> {
  await joinDemo(page);
  await expect(async () => {
    const btn = page.getByRole('button', { name: 'Use a sample lift instead' });
    if (await btn.isVisible()) await btn.click({ timeout: 2000 });
    await expect(page.getByText('Sample lift', { exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __beats: Beats }).__beats.rackOff), { timeout: 90_000 }).toBeDefined();
  await expect(page.getByText('Sending to the judges')).toBeVisible();
  return page.evaluate(() => (window as unknown as { __beats: Beats }).__beats);
}

// Look 9, plan 5.25 and 3.10 on the sample (LookieBot's checks on 23b1340 and 5d5ccb5):
// - "Good spot." and "Bar is loaded." hold 1.5 s each, with motion on and off: motion off drops
//   movement, never reading time.
// - "RACK!" stays up 1.5 s and the frozen frame comes no sooner, even though the clips end 0.17 s
//   and 0.67 s after their "Rack!": the stage holds the last frame, as on a camera lift.
// "model blocked" runs the stage at frame rate, as on a phone (headless runs the pose model at
// about a frame a second, which hides short beats); "model loaded" is the stage as it ships.
for (const motion of ['on', 'off'] as const) {
  for (const model of ['loaded', 'blocked'] as const) {
    test(`a sample lift's beats, motion ${motion}, pose model ${model}: 1.5 s holds and "RACK!" to the freeze`, async ({ page }) => {
      if (motion === 'off') await page.emulateMedia({ reducedMotion: 'reduce' });
      if (model === 'blocked') await page.route('**/models/**', r => r.abort());
      await watchBeats(page);
      const b = await liftSample(page);
      const ms = (x?: number) => Math.round(x ?? NaN);
      console.log(`beats motion ${motion} model ${model}: good spot→loaded ${ms(b.cmd['Bar is loaded.'] - b.cmd['Good spot.'])}, loaded→SQUAT ${ms(b.cmd['SQUAT!'] - b.cmd['Bar is loaded.'])}, RACK up ${ms(b.rackOff! - b.cmd['RACK!'])}, RACK→frozen ${ms(b.frozenAt! - b.cmd['RACK!'])}`);
      expect(b.cmd['Bar is loaded.'] - b.cmd['Good spot.']).toBeGreaterThanOrEqual(1400);
      expect(b.cmd['SQUAT!'] - b.cmd['Bar is loaded.']).toBeGreaterThanOrEqual(1450);
      expect(b.rackOff! - b.cmd['RACK!']).toBeGreaterThanOrEqual(1450);
      expect(b.frozenAt, 'the judged frame shows').toBeDefined();
      expect(b.frozenAt! - b.cmd['RACK!']).toBeGreaterThanOrEqual(1450);
    });
  }
}

// NerdCider's phase 2 check: a browser's own recording (a WebM with no length in its header)
// must be judged, never left to run out its leases. On the way it goes offline after the lift:
// "OK" closes the sheet and leaves her waiting on "Sending to the judges" (3.11).
test('a lift on her own camera is judged, through the offline sheet\'s OK', async ({ page, context }) => {
  test.setTimeout(9 * 60_000);
  await fakeCamera(page, '/samples/good-lift-wabba.mp4');
  await joinDemo(page);
  await expect(async () => {
    const btn = page.getByRole('button', { name: "I'm ready" });
    if (await btn.isVisible()) await btn.click({ timeout: 2000 });
    await expect(page.locator('.stage')).toBeVisible({ timeout: 2000 });
    await expect(page.getByRole('button', { name: "I'm ready" })).toBeHidden({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  // recording: once it stops, the phone has the clip and goes to send it
  await expect(page.locator('.stage.recording')).toBeVisible({ timeout: 90_000 });
  await context.setOffline(true);
  await expect(page.getByText('Your lift is saved on this phone')).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByText('Your lift is saved on this phone')).toBeHidden();
  await expect(page.getByText('Sending to the judges')).toBeVisible();
  await expect(page.getByText('Breathe.')).toBeVisible();
  await context.setOffline(false);

  await expect(page.getByRole('heading', { name: LIGHTS })).toBeVisible({ timeout: 5 * 60_000 });
  if ((await page.getByRole('heading', { name: LIGHTS }).textContent()) === 'Close call') {
    // a close call is fine (a stand-in camera can be hard to see), but never "the judge couldn't run"
    const href = await page.getByRole('link', { name: "See the referee's side of this close call" }).getAttribute('href');
    const id = href!.split('/').pop()!;
    const r = await page.request.get(`/api/attempts/${id}`);
    expect((await r.json()).reason).not.toBe('judge_unavailable');
  }
});
