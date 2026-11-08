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
