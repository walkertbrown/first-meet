// Plan 5.1's recipe card and 5.20's week page, on the running site.
import { expect, test } from '@playwright/test';

test('the landing card opens week 1\'s recipe, with Soo\'s video in a 9:16 frame', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('.recipe-card');
  await expect(card.getByText('Kimchi jjigae')).toBeVisible();
  await expect(card.getByText('김치찌개')).toBeVisible();
  await expect(card.getByText('20 g protein a serving')).toBeVisible();
  await card.getByRole('link', { name: 'Open recipe' }).click();

  await expect(page).toHaveURL(/\/recipes\/1$/);
  await expect(page.getByText('This week\'s recipe · Week 1', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Kimchi jjigae');
  await expect(page.getByText('Love Soo on YouTube · Kimchi Jjigae with only 5 ingredients!')).toBeVisible();
  await expect(page.getByText('protein a serving · serves 2')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'firm tofu' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=MhksN_jTEMo');
  await expect(page.locator('iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/MhksN_jTEMo');

  const box = (await page.locator('.recipe-video .frame').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(360.5);
  expect(box.height / box.width).toBeCloseTo(16 / 9, 1);
  // At the left of the content column, not centred, with its Caption left-aligned 8 px below (look 7).
  const col = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
  expect(Math.abs(box.x - col.x)).toBeLessThan(1);
  const cap = (await page.locator('.recipe-video .caption').boundingBox())!;
  expect(Math.abs(cap.x - col.x)).toBeLessThan(1);
  expect(cap.y - (box.y + box.height)).toBeCloseTo(8, 0);
  expect((await page.content()).toLowerCase()).not.toMatch(/calor|kcal/);
});

test('a week with no recipe is a 404', async ({ page }) => {
  const res = await page.goto('/recipes/13');
  expect(res?.status()).toBe(404);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the obangsaek band's white and black are fixed colours (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/recipes/1');
    const seg = (n: number) => page.locator(`.recipe-band i:nth-child(${n})`).evaluate(e => {
      const c = getComputedStyle(e);
      return { bg: c.backgroundColor, ring: c.boxShadow };
    });
    const white = await seg(4), black = await seg(5);
    expect(white.bg).toBe('rgb(246, 245, 240)');
    expect(black.bg).toBe('rgb(22, 24, 31)');
    if (scheme === 'light') {
      expect(white.ring).toContain('rgb(22, 24, 31)');
      expect(black.ring).toMatch(/none|rgba\(0, 0, 0, 0\)/);
    } else {
      expect(white.ring).toMatch(/none|rgba\(0, 0, 0, 0\)/);
      expect(black.ring).toContain('rgb(74, 78, 90)');
    }
  });
}

for (const width of [390, 360]) {
  test(`the landing card's Hangul never breaks inside the word (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const h = page.locator('.recipe-card .hangul');
    await expect(h).toHaveCSS('word-break', 'keep-all');
    // One line: its height is a single line box.
    const rects = await h.evaluate(el => el.getClientRects().length);
    expect(rects).toBe(1);
  });
}

test('the recipe page\'s eyebrow and Small line keep their sizes inside the page (13/16, 15/22)', async ({ page }) => {
  await page.goto('/recipes/1');
  const eyebrow = page.locator('.recipe .eyebrow');
  await expect(eyebrow).toHaveCSS('font-size', '13px');
  await expect(eyebrow).toHaveCSS('line-height', '16px');
  const small = page.getByText('Ingredients are from Soo', { exact: false });
  await expect(small).toHaveCSS('font-size', '15px');
  await expect(small).toHaveCSS('line-height', '22px');
  await expect(page.getByRole('listitem').first()).toHaveCSS('font-size', '17px');
});

for (const path of ['/does-not-exist', '/recipes/2', '/privacy']) {
  test(`a page that doesn't exist is 3.11's "Not here", in the site's frame (${path})`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Not here' })).toBeVisible();
    await expect(page.getByText("This page doesn't exist, or it moved.")).toBeVisible();
    await expect(page.getByRole('link', { name: 'First Meet, home' })).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
    await page.getByRole('link', { name: 'Go to First Meet' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
}
