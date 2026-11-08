// Plan 5.2, step 1: the words on Try a lift's first screen.
import { expect, test } from '@playwright/test';

test('Try a lift opens with its title, both ways in, and the lock line', async ({ page }) => {
  await page.goto('/try');
  await expect(page.getByRole('heading', { name: 'Try a lift' })).toBeVisible();
  await expect(page.getByText('One bodyweight squat. Your phone is the referee.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use my camera' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Watch a sample lift' })).toBeVisible();
  await expect(page.getByText("Your video stays on this phone. It's never uploaded.", { exact: true })).toBeVisible();
});

for (const width of [390, 1280]) {
  test(`the lock line sits left, the 24 px lock 8 px before its words (look 7, ${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    await page.goto('/try');
    const title = (await page.getByRole('heading', { name: 'Try a lift' }).boundingBox())!;
    const line = page.locator('.try-lock');
    const icon = (await line.locator('svg').boundingBox())!;
    const words = (await line.evaluate(el => {
      const r = document.createRange();
      r.selectNodeContents(el.lastChild!);
      const b = r.getClientRects()[0];
      return { x: b.x, y: b.y };
    }));
    expect(Math.abs(icon.x - title.x)).toBeLessThan(1);
    expect(icon.width).toBe(24);
    expect(words.x - (icon.x + icon.width)).toBeCloseTo(8, 0);
    expect(Math.abs(icon.y - words.y)).toBeLessThan(4);
  });
}

test('the landing caption under "Try a lift" is left-aligned (look 4)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const cap = page.getByText('60 seconds · no sign-up · your video stays on your phone');
  await expect(cap).toHaveCSS('text-align', 'left');
  const btn = (await page.getByRole('link', { name: 'Try a lift' }).first().boundingBox())!;
  expect(Math.abs((await cap.boundingBox())!.x - btn.x)).toBeLessThan(1);
});
