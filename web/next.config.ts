import type { NextConfig } from 'next';
import { execSync } from 'node:child_process';

// The commit this build is from, reported on /healthz (plan 2.1). Render sets RENDER_GIT_COMMIT.
function commit(): string {
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const config: NextConfig = {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_COMMIT: commit() },
  // the one judge reads ../shared/rules.json (plan 2.1)
  experimental: { externalDir: true },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        source: '/(models|fonts)/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default config;
