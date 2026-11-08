// The uptime check reads /healthz (plan 2.4): which part failed, or that nothing answered.
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JS module
import { WAIT_MS, check } from '../../scripts/uptime.mjs';

const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('the uptime check', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is up when /healthz says ok', async () => {
    vi.stubGlobal('fetch', answer(200, { ok: true, parts: { web: 'ok' } }));
    expect(await check('https://x/healthz')).toEqual({ ok: true });
  });
  it('names the parts that failed', async () => {
    vi.stubGlobal('fetch', answer(503, { ok: false, parts: { web: 'ok', db: 'timed out', r2: 'denied' } }));
    expect(await check('https://x/healthz')).toEqual({ ok: false, part: 'db, r2' });
  });
  it('says so when nothing answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await check('https://x/healthz')).toEqual({ ok: false, part: 'unreachable' });
  });
  it('gives a sleeping free-tier site up to 150 s to answer before it counts as a failure', async () => {
    expect(WAIT_MS).toBe(150_000);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', answer(200, { ok: true, parts: { web: 'ok' } }));
    await check('https://x/healthz');
    expect(timeout).toHaveBeenCalledWith(150_000);
    timeout.mockRestore();
  });
  it('gives the HTTP status when the answer is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    expect(await check('https://x/healthz')).toEqual({ ok: false, part: 'HTTP 502' });
  });
});
