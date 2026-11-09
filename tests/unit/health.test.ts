// /healthz (plan 2.4): 200 or 503 with which part failed, and the commit.
import { describe, expect, it } from 'vitest';
import { cachedFor, checkHealth } from '../../web/lib/health';

describe('the health check', () => {
  it('is ok when every part is, with the short commit', async () => {
    expect(await checkHealth({ web: async () => {} }, 'abcdef1234567890')).toEqual({ ok: true, commit: 'abcdef1', parts: { web: 'ok' } });
  });
  it('names the part that failed', async () => {
    const h = await checkHealth({ web: async () => {}, db: async () => { throw new Error('connection refused'); } }, 'abcdef1');
    expect(h.ok).toBe(false);
    expect(h.parts).toEqual({ web: 'ok', db: 'connection refused' });
  });
  it('counts a part that hangs as failed', async () => {
    const h = await checkHealth({ r2: () => new Promise(() => {}) }, 'abcdef1', 20);
    expect(h).toMatchObject({ ok: false, parts: { r2: 'timed out' } });
  });
  it('keeps the Workflow API answer for 60 s, up or down, then asks again (2.4)', async () => {
    let t = 0, calls = 0, down = false;
    const check = cachedFor(60_000, async () => { calls++; if (down) throw new Error('Workflow API 503'); }, () => t);
    await check(); await check();
    expect(calls).toBe(1);
    t = 59_999; down = true;
    await expect(check()).resolves.toBeUndefined();
    expect(calls).toBe(1);
    t = 60_000;
    await expect(check()).rejects.toThrow('Workflow API 503');
    expect(calls).toBe(2);
    t = 90_000; down = false;
    await expect(check()).rejects.toThrow('Workflow API 503');
    expect(calls).toBe(2);
    t = 120_000;
    await check();
    expect(calls).toBe(3);
  });
  it('shares one call between requests that come at once', async () => {
    let calls = 0;
    const check = cachedFor(60_000, () => { calls++; return new Promise<void>(r => setTimeout(r, 10)); }, () => 0);
    await Promise.all([check(), check(), check()]);
    expect(calls).toBe(1);
  });
});
