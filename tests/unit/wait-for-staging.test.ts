// CI's wait for staging to run the PR's commit (plan 2.1).
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JS module
import { liveCommit, waitFor } from '../../scripts/wait-for-staging.mjs';

const SHA = 'abc1234def5678';
afterEach(() => vi.unstubAllGlobals());

describe('waiting for staging', () => {
  it('reads the commit /healthz reports, or null when nothing answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, commit: 'abc1234' })));
    expect(await liveCommit('https://x/healthz')).toBe('abc1234');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await liveCommit('https://x/healthz')).toBeNull();
  });

  it('waits through a sleeping instance and the old commit, then passes on the new one', async () => {
    const answers = [null, 'old0000', 'abc1234'];
    vi.stubGlobal('fetch', vi.fn(async () => {
      const c = answers.shift();
      if (c === null) throw new TypeError('fetch failed');
      return Response.json({ ok: true, commit: c });
    }));
    const sleep = vi.fn(async () => {});
    expect(await waitFor('https://x/healthz', SHA, { sleep, log: () => {} })).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after the time allowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, commit: 'old0000' })));
    let t = 0;
    const ok = await waitFor('https://x/healthz', SHA, { minutes: 1, now: () => t, sleep: async (ms: number) => { t += ms; }, log: () => {} });
    expect(ok).toBe(false);
  });
});
