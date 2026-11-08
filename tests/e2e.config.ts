import { defineConfig } from '@playwright/test';

// The end-to-end tests: the site in headless Chromium. E2E_BASE_URL points them at a
// running site (staging, or a dev server); without it they start the built site.
const base = process.env.E2E_BASE_URL;
export default defineConfig({
  testDir: './e2e',
  timeout: 5 * 60_000,
  workers: 1,
  reporter: [['list']],
  use: { browserName: 'chromium', headless: true, baseURL: base ?? 'http://localhost:3417' },
  webServer: base ? undefined : { command: 'PORT=3417 npm start', url: 'http://localhost:3417/healthz', timeout: 120_000, cwd: '..' },
});
