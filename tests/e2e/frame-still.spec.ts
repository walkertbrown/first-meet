// Item 98 (5.25 step 9, look 9 "The frame holds still under the lamps"; piece 4, phase 4): a per-frame log of her
// frame's top and the panel's height, at 390 and 1280, with motion on and off, on a good lift, a no lift and a close
// call, with the referee's lights landing on it. Her frame doesn't move by even 1 px from the first lamp until the
// result. Then it moves once, in one 260 ms move (or at once with motion off), and never again on that screen. A close
// call's "Close call" comes in with one move too, and holds while the referee looks.
// The demo meet's squat samples come good, no lift, close call, so squat 1, 2 and 3 are the three lifts.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

test.skip(!process.env.E2E_BASE_URL, 'needs staging: the database, R2 and the judge');

/** One animation frame: her frame's top and the panel's height, and what the screen shows. */
type Row = { t: number; top: number; ph: number; lit: number; on: boolean; title: string | null };

const LIGHTS = /^(Good lift|No lift|Close call)$/;
const MOVE_MS = 260;
/** a frame at 60 Hz, and room for a busy machine's late frames around the move */
const FRAME = 1000 / 60;
const SLACK = 60;

async function logFrames(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __rows: Row[] };
    w.__rows = [];
    // What is painted, read as late in the frame as a script can: requestAnimationFrame runs before layout and before
    // the ResizeObserver callbacks, and the stage's observer moves her frame in its callback, before the same paint.
    // So each frame a new observer is made on a 1 px sentinel: observers are called in the order they were made, so
    // this one runs after the page's own, and reads the layout that frame paints.
    let dot: HTMLDivElement | null = null;
    const read = () => {
      const f = document.querySelector('.stage .footage'), p = document.querySelector('.try-stagecol .panel');
      if (!f || !p) return;
      const r = document.querySelector('.result');
      w.__rows.push({
        t: performance.now(), top: f.getBoundingClientRect().top, ph: p.getBoundingClientRect().height,
        lit: document.querySelectorAll('.stage .lamps .lamp.white, .stage .lamps .lamp.red').length,
        on: !!r?.classList.contains('on'), title: r?.querySelector('h2')?.textContent ?? null,
      });
    };
    const tick = () => {
      if (document.body && !dot?.isConnected) {
        dot = document.createElement('div');
        dot.setAttribute('aria-hidden', 'true');
        dot.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
        document.body.appendChild(dot);
      }
      if (dot) {
        // a new observation always reports once, in this frame's ResizeObserver step
        const ro = new ResizeObserver(() => { ro.disconnect(); read(); });
        ro.observe(dot);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const rows = (page: Page) => page.evaluate(() => (window as unknown as { __rows: Row[] }).__rows);
const clear = (page: Page) => page.evaluate(() => { (window as unknown as { __rows: Row[] }).__rows = []; });

async function joinDemo(page: Page, width: number) {
  await page.setViewportSize(width === 390 ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  await page.goto('/demo');
  await page.getByLabel('Name on your card').fill('E2E lifter');
  await page.getByRole('button', { name: 'Start the demo meet' }).click();
  await expect(page).toHaveURL(/\/platform\?welcome=1$/);
  const welcome = page.getByRole('dialog', { name: 'Welcome to the demo meet' });
  // wait for the sheet first: hidden before it shows would pass at once, and it would then cover the platform
  await expect(welcome).toBeVisible();
  await expect(async () => {
    if (await welcome.isVisible()) await welcome.getByRole('button', { name: 'Go to the platform' }).click({ timeout: 2000 });
    await expect(welcome).toBeHidden({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/platform$/);
}

async function liftSample(page: Page) {
  await expect(async () => {
    const btn = page.getByRole('button', { name: 'Use a sample lift instead' });
    if (await btn.isVisible()) await btn.click({ timeout: 2000 });
    await expect(page.getByText('Sample lift', { exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.locator('.result.on h2', { hasText: LIGHTS })).toBeVisible({ timeout: 5 * 60_000 });
}

/** The next squat: "Declare your next attempt", its weight, OK. */
async function declareNext(page: Page, next: number) {
  await page.getByRole('button', { name: 'Declare your next attempt' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.locator('.try-actions .btn').click();
  await sheet.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('article', { name: new RegExp(`^Squat, Attempt ${next} of 3`, 'i') })).toBeVisible({ timeout: 30_000 });
}

/** The judged frame and its marks, after the 2 s replay: the screen has nothing left to do. */
async function settle(page: Page) {
  await expect(page.locator('svg.marks:not(.bench-path) circle').first()).toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(2500);
}

const moved = (a: Row, b: Row) => Math.abs(a.top - b.top) > 0.01 || Math.abs(a.ph - b.ph) > 0.01;

/**
 * From row `at` (the frame the new words appear on) to `end`: her frame makes one move, or none. Every frame that
 * changes falls inside one 260 ms move that starts on that frame or the next, or, with motion off, on that one frame.
 * Returns what moved, for the log.
 */
function oneMove(r: Row[], at: number, end: number, motion: 'on' | 'off', what: string) {
  const changed: number[] = [];
  for (let i = Math.max(1, at); i < end; i++) if (moved(r[i - 1], r[i])) changed.push(i);
  const sum = { what, frames: changed.length, from: r[at - 1]?.top, to: r[end - 1]?.top, ms: changed.length ? r[changed.at(-1)!].t - r[changed[0]].t : 0 };
  if (!changed.length) return sum;
  const t0 = r[at].t;
  expect(r[changed[0]].t - t0, `${what}: the move starts with the words`).toBeLessThanOrEqual(2 * FRAME + SLACK);
  if (motion === 'off') expect(changed, `${what}: at once, with motion off`).toHaveLength(1);
  else {
    expect(r[changed.at(-1)!].t - t0, `${what}: one ${MOVE_MS} ms move, and nothing after it`).toBeLessThanOrEqual(MOVE_MS + 2 * FRAME + SLACK);
    expect(changed.length, `${what}: a move over several frames, not a jump`).toBeGreaterThan(3);
  }
  return sum;
}

/** From the frame before the first lamp `lamp` to the result `res`: not even 1 px. */
function holds(r: Row[], lamp: number, res: number, what: string) {
  const base = r[lamp - 1];
  const worst = Math.max(...r.slice(lamp, res).map(x => Math.max(Math.abs(x.top - base.top), Math.abs(x.ph - base.ph))));
  expect(worst, `${what}: her frame and the panel hold from the first lamp to the result`).toBeLessThan(1);
  expect(res - lamp, `${what}: the lamps took frames`).toBeGreaterThan(10);
  return { what, held: Math.round(base.ph), worst };
}

/** The lights of one lift, from the first lamp: holds, then one move, then nothing. */
function lights(r: Row[], from: number, motion: 'on' | 'off', what: string) {
  const lamp = r.findIndex((x, i) => i >= from && x.lit >= 1);
  expect(lamp, `${what}: a lamp lit`).toBeGreaterThan(0);
  const res = r.findIndex((x, i) => i > lamp && x.on && x.title !== 'Close call');
  expect(res, `${what}: the result came in`).toBeGreaterThan(lamp);
  return [holds(r, lamp, res, what), oneMove(r, res, r.length, motion, `${what}, the result`)];
}

/** The referee's lights on the close call: three whites, from the demo referee's page, unless the bot gave them. */
async function refereeWhites(browser: Page) {
  const link = browser.getByRole('link', { name: "See the referee's side of this close call" });
  if (!(await link.isVisible())) return;
  const href = await link.getAttribute('href');
  const ref = await browser.context().newPage();
  await ref.goto(href!);
  await expect(ref.getByRole('heading', { name: /^Squat 3 · /, level: 1 })).toBeVisible({ timeout: 30_000 });
  const whites = ref.getByRole('button', { name: 'White light' });
  for (let i = 0; i < 3; i++) await whites.nth(i).click();
  // wait for the save's answer: closing the tab first cancels the request when staging is slow (CI on bee6c4a)
  const saved = ref.waitForResponse(r => r.request().method() === 'POST' && /\/api\/referee\//.test(r.url()), { timeout: 60_000 });
  await ref.getByRole('button', { name: 'Save the lights' }).click();
  expect((await saved).ok(), 'the referee\'s save').toBe(true);
  await ref.close();
}

/** The rows as they are, before the checks run on them, so a failure still leaves its log. */
function dump(r: Row[], name: string) {
  const dir = join(__dirname, '../../test-results/frame-still');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name.replace(/\W+/g, '-')}.json`), JSON.stringify(r));
}

async function run(browser: Browser, width: number, motion: 'on' | 'off') {
  const ctx = await browser.newContext({ reducedMotion: motion === 'off' ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  await logFrames(page);
  await joinDemo(page, width);
  const out: unknown[] = [];
  const name = `${width} motion ${motion}`;

  // squat 1 and 2: a good lift and a no lift
  for (const [next, title] of [[2, 'Good lift'], [3, 'No lift']] as const) {
    await clear(page);
    await liftSample(page);
    await settle(page);
    const r = await rows(page);
    dump(r, `${width}-motion-${motion}-squat-${next - 1}`);
    const got = r.at(-1)!.title;
    expect(got, `${name}: squat ${next - 1} is the sample's ${title}`).toBe(title);
    out.push(...lights(r, 0, motion, `${name} ${title}`));
    await declareNext(page, next);
  }

  // squat 3, the close call: one move in, still while the referee looks, then the lights land on it
  await clear(page);
  await expect(async () => {
    const btn = page.getByRole('button', { name: 'Use a sample lift instead' });
    if (await btn.isVisible()) await btn.click({ timeout: 2000 });
    await expect(page.getByText('Sample lift', { exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.locator('.result.on h2', { hasText: LIGHTS })).toBeVisible({ timeout: 5 * 60_000 });
  let r = await rows(page);
  expect(r.at(-1)!.title, `${name}: squat 3 is the sample's close call`).toBe('Close call');
  // the close call's frame and marks, then a few quiet seconds of the referee looking
  await expect(page.locator('svg.marks:not(.bench-path) circle').first()).toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await refereeWhites(page);
  await expect(page.locator('.result.on h2', { hasText: 'Good lift' })).toBeVisible({ timeout: 2 * 60_000 });
  await settle(page);
  r = await rows(page);
  dump(r, `${width}-motion-${motion}`);
  const close = r.findIndex(x => x.on && x.title === 'Close call');
  const lamp = r.findIndex((x, i) => i > close && x.lit >= 1);
  out.push(oneMove(r, close, lamp, motion, `${name} Close call in, and the referee looking`));
  out.push(...lights(r, close, motion, `${name} the referee's lights`));
  await ctx.close();
  return { name, out };
}

test('her frame holds still under the lamps, then one move: 390 and 1280, motion on and off (item 98)', async ({ browser }) => {
  test.setTimeout(40 * 60_000);
  // FRAME_RUNS="390:on" runs one of the four, to look at it alone
  const want = process.env.FRAME_RUNS?.split(',');
  const runs = ([[390, 'on'], [390, 'off'], [1280, 'on'], [1280, 'off']] as const).filter(([w, m]) => !want || want.includes(`${w}:${m}`));
  const all = await Promise.all(runs.map(([w, m]) => run(browser, w, m)));
  console.log(`item 98 frame log: ${JSON.stringify(all)}`);
});
