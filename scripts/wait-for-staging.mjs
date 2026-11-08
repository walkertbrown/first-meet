// CI waits for staging to run the pull request's commit before the end-to-end tests (plan 2.1).
// Usage: node scripts/wait-for-staging.mjs <healthz url> <commit sha> [minutes]. Polls /healthz
// until its `commit` is the sha's first 7 characters. Node 22, no packages.
import { pathToFileURL } from 'node:url';

/** The commit /healthz reports, or null while it isn't answering (a free instance sleeps and builds). */
export async function liveCommit(url, timeoutMs = 90_000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'first-meet-ci' } });
    const body = await res.json().catch(() => null);
    return typeof body?.commit === 'string' ? body.commit : null;
  } catch {
    return null;
  }
}

export async function waitFor(url, sha, { minutes = 20, everyMs = 15_000, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), log = console.log } = {}) {
  const want = sha.slice(0, 7);
  const until = now() + minutes * 60_000;
  let last = null;
  for (;;) {
    last = await liveCommit(url);
    if (last === want) { log(`staging is on ${want}`); return true; }
    if (now() >= until) { log(`staging still on ${last ?? 'nothing'} after ${minutes} min; wanted ${want}`); return false; }
    log(`staging on ${last ?? 'nothing yet'}; waiting for ${want}`);
    await sleep(everyMs);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [url, sha, minutes] = process.argv.slice(2);
  if (!url || !sha) { console.error('usage: wait-for-staging.mjs <healthz url> <sha> [minutes]'); process.exit(2); }
  process.exit((await waitFor(url, sha, { minutes: Number(minutes) || 20 })) ? 0 : 1);
}
