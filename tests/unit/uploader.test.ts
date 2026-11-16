// The phone's uploader (3.10, piece 5) against a stand-in server and R2: 5 MB parts, a failed
// part is retried later, a second try (a reload) sends only what R2 is missing, and a demo
// lifter over the limit stops it for good.
import { describe, expect, it } from 'vitest';
import { MAX_CLIP_BYTES, PART_BYTES, Retry, Stop, sendOnce, type Net, type Pending } from '../../web/lib/stage/uploader';

function fakeServer(opts: { failPart?: number; limit?: boolean } = {}) {
  const r2 = new Map<number, string>();
  const calls: string[] = [];
  let uploaded: unknown = null, started: unknown = null, failOnce = opts.failPart;
  const net: Net = {
    async api(path, init = {}) {
      calls.push(`${init.method ?? 'GET'} ${path}`);
      const body = init.body as Record<string, unknown> | undefined;
      if (path.endsWith('/uploaded')) { uploaded = body; return { status: 200, body: { attempt: { status: 'queued' } } }; }
      if (path.includes('/upload?')) return { status: 200, body: { done: false, parts: [...r2].map(([part, etag]) => ({ part, etag })) } };
      if (path.endsWith('/upload') && body?.type) started = body;
      if (path.endsWith('/upload') && body?.type) return opts.limit ? { status: 429, body: { error: 'limit', limit: 'lifter' } } : { status: 200, body: { upload_id: 'u1' } };
      if (path.endsWith('/upload') && body?.parts) return { status: 200, body: { urls: Object.fromEntries((body.parts as number[]).map(n => [n, `put:${n}`])) } };
      return { status: 404, body: {} };
    },
    async put(url, blob) {
      const n = Number(url.split(':')[1]);
      if (n === failOnce) { failOnce = undefined; return false; }
      expect(blob.size).toBeLessThanOrEqual(PART_BYTES);
      r2.set(n, `"e${n}"`);
      return true;
    },
  };
  return { net, r2, calls, get uploaded() { return uploaded as { parts: { part: number }[]; command_times: unknown } | null; }, get started() { return started as Record<string, unknown> | null; } };
}

const pending = (): Pending => ({
  attemptId: 'a1', blob: new Blob([new Uint8Array(PART_BYTES * 2 + 1000)], { type: 'video/webm' }), type: 'video/webm;codecs=vp9',
  commandTimes: { loaded: 0, squat: 2000, rack: 6000 }, uploadId: null, savedAt: 0,
});
const noSave = async () => {};

describe('the meet video uploader', () => {
  it('sends 5 MB parts, then confirms with every part and the command times', async () => {
    const s = fakeServer();
    const p = pending();
    expect(await sendOnce(p, s.net, () => {}, noSave)).toBe('queued');
    expect([...s.r2.keys()].sort()).toEqual([1, 2, 3]);
    expect(s.uploaded!.parts.map(x => x.part)).toEqual([1, 2, 3]);
    expect(s.uploaded!.command_times).toEqual(p.commandTimes);
  });

  it('starts with the phone\'s recording time as recorded_at (3.4), or when it was saved if that is all it has', async () => {
    const s = fakeServer();
    await sendOnce({ ...pending(), savedAt: Date.UTC(2026, 10, 14, 23, 1), recordedAt: Date.UTC(2026, 10, 14, 22, 59, 30) }, s.net, () => {}, noSave);
    expect(s.started).toEqual({ type: 'video/webm;codecs=vp9', recorded_at: '2026-11-14T22:59:30.000Z' });
    const t = fakeServer();
    await sendOnce({ ...pending(), savedAt: Date.UTC(2026, 10, 14, 23, 1) }, t.net, () => {}, noSave);
    expect(t.started?.recorded_at).toBe('2026-11-14T23:01:00.000Z');
  });

  it('a part that fails is retried later, and the next try sends only what R2 is missing', async () => {
    const s = fakeServer({ failPart: 2 });
    const p = pending();
    await expect(sendOnce(p, s.net, () => {}, noSave)).rejects.toBeInstanceOf(Retry);
    expect(p.uploadId).toBe('u1');
    s.calls.length = 0;
    expect(await sendOnce(p, s.net, () => {}, noSave)).toBe('queued');
    const signed = s.calls.filter(c => c === 'POST /api/attempts/a1/upload');
    expect(signed).toHaveLength(1); // signing the missing parts, no new upload started
    expect([...s.r2.keys()].sort()).toEqual([1, 2, 3]);
  });

  it('a demo lifter over the day\'s limit stops it, nothing uploaded', async () => {
    const s = fakeServer({ limit: true });
    const err = await sendOnce(pending(), s.net, () => {}, noSave).catch(e => e);
    expect(err).toBeInstanceOf(Stop);
    expect((err as Stop).status).toEqual({ kind: 'limit', limit: 'lifter' });
    expect(s.r2.size).toBe(0);
  });

  it('a clip past the size bound is refused before anything is sent (3.11 "Your clip didn\'t send")', async () => {
    const s = fakeServer();
    const p = { ...pending(), blob: new Blob([new Uint8Array(MAX_CLIP_BYTES + 1)], { type: 'video/webm' }) };
    const err = await sendOnce(p, s.net, () => {}, noSave).catch(e => e);
    expect(err).toBeInstanceOf(Stop);
    expect((err as Stop).status).toEqual({ kind: 'refused', error: 'clip too big' });
    expect(s.calls).toHaveLength(0);
  });

  it('the phone\'s bound is the server\'s', async () => {
    const { MAX_CLIP_BYTES: server } = await import('../../web/lib/queue');
    expect(MAX_CLIP_BYTES).toBe(server);
  });

  it('no network is a retry, not a stop', async () => {
    const net: Net = { api: async () => { throw new TypeError('Failed to fetch'); }, put: async () => false };
    await expect(sendOnce(pending(), net, () => {}, noSave)).rejects.toBeInstanceOf(Retry);
  });
});
