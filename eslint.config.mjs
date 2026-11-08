// Lint (plan 2.1: typecheck and lint on each pull request). Next's rules, through the compat layer.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  { ignores: ['**/node_modules/**', '**/.next/**', 'web/public/**', 'test-results/**', 'playwright-report/**', 'web/next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  { settings: { next: { rootDir: 'web/' } } },
];
