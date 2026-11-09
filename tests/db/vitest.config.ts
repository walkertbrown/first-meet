// Tests that need Postgres (TEST_DATABASE_URL): CI runs them against a postgres service.
//   TEST_DATABASE_URL=postgres://… npx vitest run -c tests/db/vitest.config.ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../web', import.meta.url)) } },
  test: { include: ['tests/db/**/*.test.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false },
});
