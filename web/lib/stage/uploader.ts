// The meet attempt's upload from the phone (plan 3.10, piece 5). The recording is saved to
// IndexedDB first, then sent to R2 in 5 MB parts through presigned links. Each part is retried
// every 15 s and on the `online` event; a reload picks up where it stopped (the server lists the
// parts R2 already has). It leaves IndexedDB only after the server confirms the upload.

import { apiFetch } from '@/lib/stage/server-clock';

export const PART_BYTES = 5 * 1024 * 1024;
/** web/lib/queue.ts MAX_CLIP_BYTES: 90 s at 2.5 Mbps. */
export const MAX_CLIP_BYTES = 28 * 1024 * 1024;
export const RETRY_MS = 15_000;

export type Pending = {
  attemptId: string;
  blob: Blob;
  type: string;
  commandTimes: Record<string, number>;
  uploadId: string | null;
  savedAt: number;
  /** When the phone started recording (ms since 1970): the attempt's recorded_at (3.4, 3.8). */
  recordedAt?: number;
};

export type UploadStatus =
  | { kind: 'saved' } | { kind: 'sending'; sent: number; of: number } | { kind: 'offline' } | { kind: 'retrying' }
  | { kind: 'sent'; status: string } | { kind: 'limit'; limit: 'lifter' | 'everyone' } | { kind: 'refused'; error: string }
  /** item 85: the meet window turned it away (410), so it's void and isn't judged: never sent again */
  | { kind: 'window'; reason: 'after_close' | 'upload_late'; closesAt: string | null; deadline: string | null };

const DB = 'first-meet';
const STORE = 'uploads';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'attemptId' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((res, rej) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => res(req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  } finally { db.close(); }
}

export const savePending = (p: Pending) => tx('readwrite', s => s.put(p));
export const getPending = (id: string) => tx<Pending | undefined>('readonly', s => s.get(id) as IDBRequest<Pending | undefined>);
export const allPending = () => tx<Pending[]>('readonly', s => s.getAll() as IDBRequest<Pending[]>);
export const dropPending = (id: string) => tx('readwrite', s => s.delete(id));

/** What the uploader asks of the network: the app's API and R2. A stand-in in the tests. */
export type Net = {
  api(path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body: Record<string, unknown> }>;
  put(url: string, body: Blob): Promise<boolean>;
};

export const browserNet: Net = {
  async api(path, init = {}) {
    // our API, never cached: each answer also corrects the phone's clock (item 86)
    const res = await apiFetch(path, {
      method: init.method ?? 'GET',
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  },
  async put(url, body) {
    const res = await fetch(url, { method: 'PUT', body });
    return res.ok;
  },
};

export class Retry extends Error {}
export class Stop extends Error { constructor(public status: UploadStatus) { super(status.kind); } }

/**
 * One try at sending a saved recording, from wherever it stopped. Throws Retry when the network
 * or R2 failed (try again later), Stop when the server won't take it (don't).
 */
export async function sendOnce(p: Pending, net: Net, onStatus: (s: UploadStatus) => void, save: (p: Pending) => Promise<unknown> = savePending): Promise<string> {
  // 3.11: a clip past the bound is refused before anything is sent
  if (p.blob.size > MAX_CLIP_BYTES) throw new Stop({ kind: 'refused', error: 'clip too big' });
  const parts = Math.max(1, Math.ceil(p.blob.size / PART_BYTES));
  const api = async (path: string, init?: { method?: string; body?: unknown }) => {
    let r;
    try { r = await net.api(path, init); } catch { throw new Retry(); }
    if (r.status >= 500 || r.status === 0) throw new Retry();
    if (r.status === 410) {
      throw new Stop({
        kind: 'window', reason: r.body.void_reason === 'after_close' ? 'after_close' : 'upload_late',
        closesAt: (r.body.closes_at as string | null) ?? null, deadline: (r.body.clip_deadline_at as string | null) ?? null,
      });
    }
    return r;
  };
  const base = `/api/attempts/${p.attemptId}`;
  let have = new Set<number>();
  if (p.uploadId) {
    const r = await api(`${base}/upload?upload_id=${encodeURIComponent(p.uploadId)}`);
    if (r.status === 200 && r.body.done) return finish(p, api, onStatus, []);
    if (r.status === 200) have = new Set((r.body.parts as { part: number }[]).map(x => x.part));
    else p.uploadId = null; // the upload is gone (finished elsewhere, or expired): start it again
  }
  if (!p.uploadId) {
    // recorded_at comes from the phone (3.4): a clip filmed before the close counts if it sends later (3.8)
    const r = await api(`${base}/upload`, { method: 'POST', body: { type: p.type, recorded_at: new Date(p.recordedAt ?? p.savedAt).toISOString() } });
    if (r.status === 429) throw new Stop({ kind: 'limit', limit: r.body.limit as 'lifter' | 'everyone' });
    if (r.status === 409) {
      // already queued or judged (another tab, or a confirm we never heard): the server has it
      const st = await api(base);
      if (st.status === 200 && st.body.status !== 'declared') throw new Stop({ kind: 'sent', status: String(st.body.status) });
    }
    if (r.status !== 200) throw new Stop({ kind: 'refused', error: String(r.body.error ?? r.status) });
    p.uploadId = String(r.body.upload_id);
    await save(p);
  }
  const missing = Array.from({ length: parts }, (_, i) => i + 1).filter(n => !have.has(n));
  onStatus({ kind: 'sending', sent: parts - missing.length, of: parts });
  if (missing.length) {
    const r = await api(`${base}/upload`, { method: 'POST', body: { upload_id: p.uploadId, parts: missing } });
    if (r.status !== 200) throw new Stop({ kind: 'refused', error: String(r.body.error ?? r.status) });
    const urls = r.body.urls as Record<string, string>;
    let sent = parts - missing.length;
    for (const n of missing) {
      const slice = p.blob.slice((n - 1) * PART_BYTES, Math.min(p.blob.size, n * PART_BYTES));
      let ok = false;
      try { ok = await net.put(urls[n], slice); } catch { ok = false; }
      if (!ok) throw new Retry();
      onStatus({ kind: 'sending', sent: ++sent, of: parts });
    }
  }
  // R2 has every part: the server reads their ETags back from R2 itself (no CORS header needed)
  const listed = await api(`${base}/upload?upload_id=${encodeURIComponent(p.uploadId)}`);
  if (listed.status === 200 && listed.body.done) return finish(p, api, onStatus, []);
  if (listed.status !== 200) throw new Retry();
  const got = listed.body.parts as { part: number; etag: string }[];
  if (got.length < parts) throw new Retry();
  return finish(p, api, onStatus, got.map(x => ({ part: x.part, etag: x.etag })));
}

async function finish(p: Pending, api: (path: string, init?: { method?: string; body?: unknown }) => Promise<{ status: number; body: Record<string, unknown> }>,
  onStatus: (s: UploadStatus) => void, parts: { part: number; etag: string }[]) {
  const r = await api(`/api/attempts/${p.attemptId}/uploaded`, { method: 'POST', body: { upload_id: p.uploadId, parts, command_times: p.commandTimes } });
  if (r.status !== 200) throw new Stop({ kind: 'refused', error: String(r.body.error ?? r.status) });
  const status = String((r.body.attempt as { status?: string } | undefined)?.status ?? 'queued');
  onStatus({ kind: 'sent', status });
  return status;
}

/**
 * Sends one saved recording until the server has it: every 15 s and on `online` after a failure.
 * Resolves with the attempt's status, or with the reason it stopped. Removes it from IndexedDB
 * only once the server has confirmed it (or turned it away for good).
 */
export function keepSending(attemptId: string, onStatus: (s: UploadStatus) => void, net: Net = browserNet): { done: Promise<UploadStatus>; cancel: () => void } {
  let cancelled = false, wake: (() => void) | null = null;
  const nap = () => new Promise<void>(res => {
    const t = setTimeout(go, RETRY_MS);
    function go() { clearTimeout(t); removeEventListener('online', go); wake = null; res(); }
    addEventListener('online', go);
    wake = go;
  });
  const done = (async (): Promise<UploadStatus> => {
    for (;;) {
      if (cancelled) return { kind: 'retrying' };
      const p = await getPending(attemptId).catch(() => undefined);
      if (!p) {
        const status = { kind: 'refused', error: 'not saved on this phone' } as const;
        reportFailed(net, attemptId, status.error, true);
        return status;
      }
      try {
        const status = await sendOnce(p, net, onStatus);
        await dropPending(attemptId).catch(() => {});
        return { kind: 'sent', status };
      } catch (e) {
        if (e instanceof Stop) {
          await dropPending(attemptId).catch(() => {});
          if (e.status.kind === 'refused') reportFailed(net, attemptId, e.status.error, !p.uploadId);
          onStatus(e.status);
          return e.status;
        }
        onStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? { kind: 'offline' } : { kind: 'retrying' });
        await nap();
      }
    }
  })();
  return { done, cancel: () => { cancelled = true; wake?.(); } };
}

/**
 * "Your clip didn't send": tells the server why, for /ops (2.4, failed and refused uploads by
 * device). `beforeStart`: no upload had begun. Never holds up the sheet; a lost report is only a
 * missing count.
 */
function reportFailed(net: Net, attemptId: string, error: string, beforeStart: boolean) {
  void net.api(`/api/attempts/${attemptId}/upload-failed`, { method: 'POST', body: { error, before_start: beforeStart } }).catch(() => {});
}

/** On page load: anything saved but not yet confirmed keeps sending (a reload resumes). */
export async function resumeAll(onStatus: (id: string, s: UploadStatus) => void = () => {}) {
  const all = await allPending().catch(() => [] as Pending[]);
  return all.map(p => keepSending(p.attemptId, s => onStatus(p.attemptId, s)));
}
