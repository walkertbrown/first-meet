// /healthz (plan 2.4): 200 or 503 with which part failed, and the commit.
import { describe, expect, it } from 'vitest';
import { checkHealth } from '../../web/lib/health';

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
});
