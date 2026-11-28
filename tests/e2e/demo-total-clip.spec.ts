// Phase 4 on staging, the whole way: the demo meet's nine lifts to a total, then her card's clip made by the real clip
// run on Render (3.9 step 6, item 101), and her certificate on one US Letter sheet (5.30 Print). Each lift's samples
// cycle good lift, no lift, close call; the test referee saves each close call with three whites.
// With FAULT=clip on the staging web service (item 102), CLIP_EXPECT=failed checks the other ending: "Your clip couldn't
// be made." with "Try again", and after the second failure "We've told the team." with no button.
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'needs staging: the database, R2, the judge, the test referee and the clip run');

const LIGHTS = /^(Good lift|No lift|Close call)$/;
const LIFTS = ['Squat', 'Bench press', 'Deadlift'] as const;
const expectFailed = process.env.CLIP_EXPECT === 'failed';
const CARD_MAKING = 'Your clip is being made. It takes about a minute.';

/** Render's edge answers a burst of headless loads with a Cloudflare "Performing security verification" page (429), not the app. */
async function notEdgeCheck(p: Page) {
  // a refresh the edge refuses turns into a full page load, so let any load finish first
  await p.waitForLoadState('load');
  const check = p.getByText('Performing security verification', { exact: false });
  if (await check.count()) throw new Error("Render's edge bot check (Cloudflare) answered instead of the app; wait a while before running this again");
}

async function joinDemo(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await page.getByLabel('Name on your card').fill('E2E total');
  await page.getByRole('button', { name: 'Start the demo meet' }).click();
  await expect(page).toHaveURL(/\/platform\?welcome=1$/);
  const welcome = page.getByRole('dialog', { name: 'Welcome to the demo meet' });
  await expect(welcome).toBeVisible();
  await expect(async () => {
    if (await welcome.isVisible()) await welcome.getByRole('button', { name: 'Go to the platform' }).click({ timeout: 2000 });
    await expect(welcome).toBeHidden({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/platform$/);
}

/** One sample to its lights; a close call, the test referee saves three whites. Returns her result. */
async function liftOne(page: Page): Promise<string> {
  await expect(async () => {
    const btn = page.getByRole('button', { name: 'Use a sample lift instead' });
    if (await btn.isVisible()) await btn.click({ timeout: 2000 });
    await expect(page.getByText('Sample lift', { exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  const title = page.locator('.result.on h2', { hasText: LIGHTS });
  await expect(title).toBeVisible({ timeout: 5 * 60_000 });
  const t = (await title.textContent())!.trim();
  if (t !== 'Close call') return t;
  const href = await page.getByRole('link', { name: "See the referee's side of this close call" }).getAttribute('href');
  // her own session: the demo's close call is hers to see
  const ref = await page.context().newPage();
  try {
    await ref.goto(href!);
    const whites = ref.getByRole('button', { name: 'White light' });
    await expect(whites.first()).toBeVisible({ timeout: 30_000 });
    for (let i = 0; i < 3; i++) await whites.nth(i).click();
    // wait for the save's answer: closing the tab first cancels the request when staging is slow (CI on bee6c4a)
    const saved = ref.waitForResponse(r => r.request().method() === 'POST' && /\/api\/referee\//.test(r.url()), { timeout: 60_000 });
    await ref.getByRole('button', { name: 'Save the lights' }).click();
    expect((await saved).ok(), 'the referee\'s save').toBe(true);
  } finally { await ref.close(); }
  await expect(page.locator('.result.on h2', { hasText: 'Good lift' })).toBeVisible({ timeout: 60_000 });
  return 'Good lift';
}

async function declareNext(page: Page, lift: string, next: number) {
  await page.getByRole('button', { name: 'Declare your next attempt' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.locator('.try-actions .btn').click();
  await sheet.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('article', { name: new RegExp(`^${lift}, Attempt ${next} of 3`, 'i') })).toBeVisible({ timeout: 30_000 });
}

test(`the demo meet to a total on staging: her card's clip is ${expectFailed ? "couldn't be made (FAULT=clip)" : 'made'}, and the certificate prints on one sheet`, async ({ browser }) => {
  test.setTimeout(45 * 60_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const step = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);
  // with FAULT=clip, the test admin's /ops is opened first (signing in after the lifts has stalled on staging)
  const ops = expectFailed ? await (await browser.newContext()).newPage() : null;
  try {
    if (ops) {
      ops.setDefaultTimeout(60_000);
      ops.setDefaultNavigationTimeout(60_000);
      await ops.goto('/signin/test');
      await notEdgeCheck(ops);
      await ops.getByRole('button', { name: 'Sign in as the test admin' }).click();
      await expect(ops).toHaveURL(/\/ops$/, { timeout: 30_000 });
      step('ops signed in');
    }
    await joinDemo(page);
    const results: string[] = [];
    for (const [i, lift] of LIFTS.entries()) {
      for (let n = 1; n <= 3; n++) {
        results.push(`${lift} ${n}: ${await liftOne(page)}`);
        if (n < 3) await declareNext(page, lift, n + 1);
        else if (i < 2) {
          await page.getByRole('button', { name: new RegExp(`^(Declare your next attempt|Next: ${LIFTS[i + 1]})$`) }).click();
          await expect(page.getByRole('article', { name: new RegExp(`^${LIFTS[i + 1]}, Attempt 1 of 3`, 'i') })).toBeVisible({ timeout: 30_000 });
        }
      }
    }
    console.log(results.join('\n'));

    // "See your total" the moment the ninth lights show (LookieBot saw "a client-side exception" here once at e0e2353,
    // not reproduced): the total page opens, and no script on it throws or fails to load
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`));
    page.on('requestfailed', (r) => { if (/\/_next\/static\//.test(r.url())) pageErrors.push(`script failed to load: ${r.url()}`); });
    await page.getByRole('button', { name: 'See your total' }).or(page.getByRole('link', { name: 'See your total' })).first().click();
    await expect(page).toHaveURL(/\/platform\/total$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /^(You totaled, E2E total\.|You finished your first meet\.)$/, level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Application error', { exact: false })).toHaveCount(0);
    await page.waitForTimeout(3000); // the count-up runs
    expect(pageErrors, 'the total page, no page error').toEqual([]);

    // her card: the clip is being made, then made (or, with FAULT=clip, couldn't be)
    await page.goto('/me/card');
    await expect(page.getByRole('heading', { name: 'Your meet card', level: 1 })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('radio', { name: 'Clip' }).check();
    const frame = page.locator('.card-frame.story');
    if (!expectFailed) {
      await expect(frame.locator('video')).toBeVisible({ timeout: 10 * 60_000 });
      const ok = await frame.locator('video').evaluate(async (v: HTMLVideoElement) => {
        const r = await fetch(v.currentSrc || v.src);
        return { status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength };
      });
      expect(ok.status).toBe(200);
      expect(ok.type).toMatch(/^video\/mp4/);
      expect(ok.bytes).toBeGreaterThan(50_000);

      // item 99: the demo's clips are "Only the judges", so her clip isn't on her card link until she shares it
      const token = (await frame.locator('video').getAttribute('src'))!.match(/^\/api\/card\/([^/.]+)\.mp4$/)![1];
      await expect(page.getByText('Your clip is only for you until you share it. Sharing it makes this clip, and only this clip, public.', { exact: true })).toBeVisible();
      const anon = await browser.newContext();
      try {
        const pub = await anon.newPage();
        // look 5.15: while her Story is still being drawn, its frame pulses (`--surface-2`, 1 → .6 → 1 over
        // 1.6 s), holds at .8 with motion off, and stops with no fade once the image is there.
        let release!: () => void;
        const held = new Promise<void>(r => { release = r; });
        await pub.route(/\/api\/card\/[^/]+\.png\?f=story$/, async route => { await held; await route.continue(); });
        // its Story is held, so the page's load event waits on it: go on once the page is there
        await pub.goto(`/card/${token}`, { waitUntil: 'domcontentloaded' });
        const waiting = pub.locator('.card-frame.story.drawing:not([data-drawn])');
        await expect(waiting).toHaveCount(1, { timeout: 30_000 });
        const pulse = () => waiting.evaluate(el => {
          const b = getComputedStyle(el, '::before');
          const probe = document.createElement('i');
          probe.style.color = 'var(--surface-2)';
          document.body.append(probe);
          const surface2 = getComputedStyle(probe).color;
          probe.remove();
          return { content: b.content, bg: b.backgroundColor, surface2, name: b.animationName, s: b.animationDuration, opacity: b.opacity };
        });
        const moving = await pulse();
        expect(moving.content).not.toBe('none');
        expect(moving.bg).toBe(moving.surface2);
        expect({ name: moving.name, s: moving.s }).toEqual({ name: 'card-wait', s: '1.6s' });
        await pub.emulateMedia({ reducedMotion: 'reduce' });
        expect(await pulse()).toMatchObject({ name: 'none', opacity: '0.8' });
        await pub.emulateMedia({ reducedMotion: 'no-preference' });
        release();
        await expect(pub.locator('.card-frame.story.drawing[data-drawn]')).toHaveCount(1, { timeout: 60_000 });
        expect(await pub.locator('.card-frame.story').evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
        await pub.unroute(/\/api\/card\/[^/]+\.png\?f=story$/);
        await expect(pub.getByRole('img', { name: /meet card$/ })).toBeVisible({ timeout: 30_000 });
        await expect(pub.getByRole('button', { name: 'Watch her lift' })).toHaveCount(0);
        expect((await pub.request.get(`/api/card/${token}.mp4`)).status(), 'the clip file is closed before she shares').not.toBe(200);
        // Share: headless Chromium can't share a file, so it saves it, and that shares the clip all the same
        const saved = page.waitForEvent('download');
        const shareSave = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/me/card/share-clip'), { timeout: 60_000 });
        await page.getByRole('button', { name: 'Share', exact: true }).click();
        await saved;
        // CI on 0dcae82: the save never landed and nothing said why. Render's edge refusing the POST (Cloudflare,
        // 429 or 403) is the edge, not the app; any other failure is ours.
        const res = await shareSave;
        if (!res.ok() && /cloudflare/i.test(res.headers()['server'] ?? '') && [403, 429].includes(res.status())) {
          throw new Error(`Render's edge bot check (Cloudflare ${res.status()}) refused her share save; wait a while before running this again`);
        }
        expect(res.status(), 'her share save').toBe(200);
        await expect(page.getByText('Your clip is on your card link now. Anyone with the link can watch it.', { exact: true })).toBeVisible();
        await page.reload();
        await page.getByRole('radio', { name: 'Clip' }).check();
        await expect(page.getByText('Your clip is on your card link now. Anyone with the link can watch it.', { exact: true })).toBeVisible({ timeout: 30_000 });
        await pub.reload();
        await pub.getByRole('button', { name: 'Watch her lift' }).click();
        const v = pub.locator('.card-frame video');
        await expect(v).toBeVisible();
        await expect.poll(() => v.evaluate((e: HTMLVideoElement) => e.readyState), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
      } finally { await anon.close(); }
    } else if (ops) {
      // /ops counts her clip once, when it has failed for good, not at the first failure.
      // The count is read off the /ops tab opened before the lifts, which re-reads itself every 10 s. After a burst of
      // headless runs from one machine, Render's edge answers with its bot check (Cloudflare, 429 or 403) instead of
      // the app; notEdgeCheck says so rather than failing on a missing heading.
      // Every step has its own limit, so a stall names its line instead of running out the test's 45 minutes.
      page.setDefaultTimeout(60_000);
      try {
        const failedCount = async () => {
          await notEdgeCheck(ops);
          await expect(ops.getByRole('heading', { name: 'ERRORS', level: 2 })).toBeVisible({ timeout: 5000 });
          const row = ops.locator('.ops-row', { hasText: /^Clips that failed · \d+$/ });
          return (await row.count()) ? Number(await row.locator('.num').textContent({ timeout: 5000 })) : 0;
        };
        const before = await failedCount();
        step(`ops before: ${before}`);
        await expect(frame.getByRole('heading', { name: "Your clip couldn't be made." })).toBeVisible({ timeout: 15 * 60_000 });
        await expect(frame.getByText('Your card is ready to share. You can try the clip again.', { exact: true })).toBeVisible();
        step('first failure on her card');
        await ops.waitForTimeout(12_000); // one more of /ops's own refreshes
        expect(await failedCount(), 'not counted while she can still try again').toBe(before);
        step('ops not counted yet');
        await frame.getByRole('button', { name: 'Try again' }).click();
        step('Try again pressed');
        await expect(frame.getByText(CARD_MAKING, { exact: true })).toBeVisible();
        await expect(frame.getByText("We've told the team.", { exact: true })).toBeVisible({ timeout: 15 * 60_000 });
        await expect(frame.getByRole('button', { name: 'Try again' })).toHaveCount(0);
        step('final failure on her card');
        // it stays after a reload: it's what was saved
        await page.reload();
        await page.getByRole('radio', { name: 'Clip' }).check();
        await expect(frame.getByText("We've told the team.", { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(frame.getByRole('button', { name: 'Try again' })).toHaveCount(0);
        step('reloaded: still final');
        await expect.poll(failedCount, { message: '/ops "Clips that failed" counts hers', timeout: 60_000, intervals: [5000] }).toBe(before + 1);
        step(`/ops Clips that failed: ${before} before, ${before + 1} after`);
      } finally { await ops.context().close().catch(() => {}); }
      page.setDefaultTimeout(0);
    }

    // the certificate: one US Letter page
    await page.goto('/me/card/print');
    await expect(page.locator('.cert')).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
    expect((pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length, 'one sheet').toBe(1);
    expect(pdf.match(/\/MediaBox\s*\[([^\]]+)\]/)?.[1].trim().split(/\s+/).map(Number), 'US Letter').toEqual([0, 0, 612, 792]);
  } finally {
    await ctx.close();
  }
});
