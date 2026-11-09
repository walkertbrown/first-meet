import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../web', import.meta.url)) } },
  test: { include: ['tests/worker/**/*.test.ts'], root: fileURLToPath(new URL('../..', import.meta.url)), environment: 'node', fileParallelism: false },
});
