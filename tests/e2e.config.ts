import { defineConfig } from '@playwright/test';

// The end-to-end tests: the site in headless Chromium. E2E_BASE_URL points them at a
// running site (staging, or a dev server); without it they start the built site.
const base = process.env.E2E_BASE_URL;
export default defineConfig({
  testDir: './e2e',
  timeout: 5 * 60_000,
  workers: 1,
  // in CI, "line" prints a failure's error as it happens, not at the end, so a run that is stopped still says why
  reporter: process.env.CI ? [['line']] : [['list']],
  // A failure keeps its screenshot next to the page snapshot, and CI uploads them both. A click or a page load that
  // waits two minutes has stalled (on ebc7590 one ran CI out of time with no line named), so it fails, naming its line.
  use: {
    browserName: 'chromium', headless: true, baseURL: base ?? 'http://localhost:3417', screenshot: 'only-on-failure',
    actionTimeout: 2 * 60_000, navigationTimeout: 2 * 60_000,
  },
  webServer: base ? undefined : { command: 'PORT=3417 npm start', url: 'http://localhost:3417/healthz', timeout: 120_000, cwd: '..' },
});
