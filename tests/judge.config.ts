import { defineConfig } from '@playwright/test';

// The judge tests: the one judge, in headless Chromium, on tests/clips/.
export default defineConfig({
  testDir: './judge',
  timeout: 10 * 60_000,
  workers: 1,
  reporter: [['list']],
  use: { browserName: 'chromium', headless: true },
});
