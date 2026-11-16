// The phone's clock, corrected by our server's (plan 3.2, 3.8, item 86). A phone whose clock runs
// slow could start a lift after the close and have it count, so each answer from our own API
// (fetched with `cache: 'no-store'`, never a service worker's or the HTTP cache's copy, never a
// static file) gives a difference: the server's Date + half the round trip − the phone's clock. A
// round trip over 5 s is ignored. The newest good difference is kept on the phone (IndexedDB), so
// a lift filmed offline still uses it; with none saved, the phone's own clock. There's no jump
// rule: the newest good sample wins. It's used for `recorded_at` and for the phone's close check;
// the server still clamps `recorded_at` to [declared, server now].

export const MAX_RTT_MS = 5_000;

/** The difference one answer gives, or null when it can't be trusted (no Date, a slow round trip). */
export function clockSample(sentAt: number, gotAt: number, date: string | null | undefined): number | null {
  if (!date) return null;
  const server = Date.parse(date);
  const rtt = gotAt - sentAt;
  if (!Number.isFinite(server) || rtt < 0 || rtt > MAX_RTT_MS) return null;
  return server + rtt / 2 - gotAt;
}

const DB = 'first-meet-clock';
const STORE = 'clock';
let diff: number | null = null;
let loading: Promise<void> | null = null;

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return res(undefined);
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); res(req ? req.result : undefined); };
      t.onerror = () => { db.close(); rej(t.error); };
    };
  });
}

/** Reads the saved difference once (call early; `phoneNow` uses the phone's clock until it's in). */
export function loadClock(): Promise<void> {
  loading ??= idb<number>('readonly', s => s.get('diff') as IDBRequest<number>)
    .then(v => { if (diff === null && typeof v === 'number') diff = v; })
    .catch(() => {});
  return loading;
}

/** Keeps a good sample: in memory now, and on the phone for next time. */
export function noteSample(d: number | null) {
  if (d === null) return;
  diff = d;
  void idb('readwrite', s => { s.put(d, 'diff'); }).catch(() => {});
}

/** Now, by the corrected clock (ms since 1970). */
export const phoneNow = () => Date.now() + (diff ?? 0);
/** The difference in use (for the tests and /ops); null: the phone's own clock. */
export const clockDiff = () => diff;
/** Tests only. */
export const resetClock = () => { diff = null; loading = null; };

/** A fetch of our own API that also reads the server's clock. Always `no-store`. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  void loadClock();
  const sentAt = Date.now();
  const res = await fetch(path, { credentials: 'same-origin', ...init, cache: 'no-store' });
  if (path.startsWith('/api/')) noteSample(clockSample(sentAt, Date.now(), res.headers.get('date')));
  return res;
}
