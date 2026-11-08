// /healthz (plan 2.4): each part First Meet runs on, checked, with the commit this build is from.
// Phase 1 has only the web service; the database, R2 and the Workflow join their checks here as
// each is built (phase 2), and a part that fails turns the answer into a 503 naming it.
export type PartCheck = () => Promise<void>;
export type Health = { ok: boolean; commit: string; parts: Record<string, 'ok' | string> };

export async function checkHealth(parts: Record<string, PartCheck>, commit: string, timeoutMs = 5000): Promise<Health> {
  const out: Health['parts'] = {};
  await Promise.all(Object.entries(parts).map(async ([name, check]) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([check(), new Promise((_, no) => { timer = setTimeout(() => no(new Error('timed out')), timeoutMs); })]);
      out[name] = 'ok';
    } catch (e) {
      out[name] = (e as Error).message || 'failed';
    } finally {
      clearTimeout(timer);
    }
  }));
  return { ok: Object.values(out).every(v => v === 'ok'), commit: commit.slice(0, 7), parts: out };
}
