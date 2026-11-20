// Item 112 (plan 3.4b, "A second one in a row, on the same attempt"): the bench's voids in a row on one attempt.
// The phone posts the void as soon as it's voided and the server answers with `n` (its own count, from the rows,
// reset at the attempt's last `upload_started`). The sheet never waits for it: if no answer has come by the end
// of "Rack!"'s 900 ms, the phone uses its own count for that attempt, kept here. Filming the attempt through to
// "Rack!" resets it, as the server's upload_started does. Each attempt counts on its own.
const key = (attemptId: string) => `fm-voids-${attemptId}`;

function read(attemptId: string): number {
  try { const v = Number(localStorage.getItem(key(attemptId))); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; } catch { return 0; }
}
function write(attemptId: string, n: number) {
  try { if (n > 0) localStorage.setItem(key(attemptId), String(n)); else localStorage.removeItem(key(attemptId)); } catch { /* private mode: counted in this page only */ }
}

const inPage = new Map<string, number>();

/** One more void on this attempt, on the phone; returns the phone's count. */
export function bumpVoids(attemptId: string): number {
  const n = Math.max(read(attemptId), inPage.get(attemptId) ?? 0) + 1;
  inPage.set(attemptId, n); write(attemptId, n);
  return n;
}

/** The server's count came back: the phone's follows it. */
export function syncVoids(attemptId: string, n: number) {
  if (!Number.isInteger(n) || n < 1) return;
  inPage.set(attemptId, n); write(attemptId, n);
}

/** Filmed through to "Rack!": the next void on this attempt is the first again. */
export function resetVoids(attemptId: string) {
  inPage.delete(attemptId); write(attemptId, 0);
}

/** The sheet's count: the server's if it answered in time, else the phone's. */
export const voidsInRow = (server: number | null, phone: number) => (server !== null && server >= 1 ? server : phone);

/** From the second in a row, the second sheet (the third and later show the same one). */
export const secondSheet = (n: number) => n >= 2;
