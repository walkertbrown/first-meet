// The uptime check reads /healthz (plan 2.4): which part failed, or that nothing answered.
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JS module
import { WAIT_MS, check, watchIssues } from '../../scripts/uptime.mjs';

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

describe("the uptime check's other two issues (2.4)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it('passes on what /healthz watches, without failing health over it', async () => {
    const watch = { oldest_queued_age_s: 900, referee_bot: null };
    vi.stubGlobal('fetch', answer(200, { ok: true, parts: { web: 'ok' }, watch }));
    expect(await check('https://x/healthz')).toEqual({ ok: true, watch });
  });
  it('"Lights are slow" once the oldest waiting attempt is over 10 minutes old, closed once it isn\'t', () => {
    expect(watchIssues({ oldest_queued_age_s: 601, referee_bot: null })[0]).toMatchObject({ title: 'Lights are slow', open: true });
    expect(watchIssues({ oldest_queued_age_s: 600, referee_bot: null })[0]).toEqual({ title: 'Lights are slow', open: false });
    expect(watchIssues({ oldest_queued_age_s: null, referee_bot: null })[0].open).toBe(false);
  });
  it('"Referee bot not running: <reason>" after 10 minutes of the red line, closed once it\'s back', () => {
    expect(watchIssues({ oldest_queued_age_s: null, referee_bot: { not_running: 'spend limit reached', for_s: 600 } })[1])
      .toMatchObject({ title: 'Referee bot not running', open: true, full: 'Referee bot not running: spend limit reached' });
    expect(watchIssues({ oldest_queued_age_s: null, referee_bot: { not_running: 'too slow', for_s: 599 } })[1].open).toBe(false);
    expect(watchIssues({ oldest_queued_age_s: null, referee_bot: null })[1]).toEqual({ title: 'Referee bot not running', open: false });
  });
  it('an older web without the watch opens and closes nothing', () => {
    expect(watchIssues(undefined)).toEqual([]);
  });
});
