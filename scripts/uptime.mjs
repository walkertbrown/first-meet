// The uptime check (plan 2.4), shared by the GitHub schedule and, from phase 2, the Render cron
// job. Checks /healthz twice, 60 s apart; two failures open the issue "First Meet is down:
// <part>", and a healthy check closes any open one. Needs HEALTH_URL, GITHUB_TOKEN and
// GITHUB_REPOSITORY. Node 22, no packages.
const { HEALTH_URL, GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
const TITLE = 'First Meet is down';

export async function check(url, timeoutMs = 90_000) {
  try {
    // A sleeping free instance takes about a minute to wake, so the wait is long.
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'first-meet-uptime' } });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.ok) return { ok: true };
    const failed = body?.parts ? Object.entries(body.parts).filter(([, v]) => v !== 'ok').map(([k]) => k) : [];
    return { ok: false, part: failed.join(', ') || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, part: e.name === 'TimeoutError' ? 'no answer' : 'unreachable' };
  }
}

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'first-meet-uptime', ...init.headers },
  });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  let r = await check(HEALTH_URL);
  if (!r.ok) {
    await new Promise(res => setTimeout(res, 60_000));
    r = await check(HEALTH_URL);
  }
  const open = (await gh('/issues?state=open&per_page=100')).filter(i => !i.pull_request && i.title.startsWith(TITLE));
  if (r.ok) {
    for (const i of open) {
      await gh(`/issues/${i.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `Back up at ${new Date().toISOString()}.` }) });
      await gh(`/issues/${i.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
    }
    console.log('up');
    return;
  }
  console.log(`down: ${r.part}`);
  if (!open.length) {
    await gh('/issues', { method: 'POST', body: JSON.stringify({ title: `${TITLE}: ${r.part}`, body: `${HEALTH_URL} failed twice, 60 s apart, at ${new Date().toISOString()}.` }) });
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
