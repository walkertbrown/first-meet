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
  expect((await page.content()).toLowerCase()).not.toMatch(/calor|kcal/);
});

test('a week with no recipe is a 404', async ({ page }) => {
  const res = await page.goto('/recipes/13');
  expect(res?.status()).toBe(404);
});
