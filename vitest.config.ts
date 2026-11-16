import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./web', import.meta.url)) } },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'web/**/*.test.ts'],
    environment: 'node',
    // a few tests import the whole platform screen inside the test; with every file in parallel
    // that import alone can pass 5 s
    testTimeout: 20_000,
  },
});
