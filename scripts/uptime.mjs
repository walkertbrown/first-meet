// The uptime check (plan 2.4), shared by the GitHub schedule and, from phase 2, the Render cron
// job. Checks /healthz twice, 60 s apart; two failures open the issue "First Meet is down:
// <part>", and a healthy check closes any open one. Needs HEALTH_URL, GITHUB_TOKEN and
// GITHUB_REPOSITORY; HEALTH_WAIT_MS overrides the wait. Node 22, no packages.
const { HEALTH_URL, GITHUB_TOKEN, GITHUB_REPOSITORY, HEALTH_WAIT_MS } = process.env;
const TITLE = 'First Meet is down';

/**
 * How long each /healthz may take before it counts as a failure. While production is on
 * Render's free tier it sleeps and takes about a minute to wake (80 s seen on Nov 8), so the
 * outside check waits up to 150 s (plan 2.4).
 */
export const WAIT_MS = Number(HEALTH_WAIT_MS) || 150_000;

export async function check(url, timeoutMs = WAIT_MS) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'first-meet-uptime' } });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.ok) return body.watch ? { ok: true, watch: body.watch } : { ok: true };
    const failed = body?.parts ? Object.entries(body.parts).filter(([, v]) => v !== 'ok').map(([k]) => k) : [];
    return { ok: false, part: failed.join(', ') || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, part: e.name === 'TimeoutError' ? 'no answer' : 'unreachable' };
  }
}

/** 2.4: a queue older than this opens "Lights are slow"; the referee bot down this long opens its issue. */
export const SLOW_S = 10 * 60;
export const BOT_DOWN_S = 10 * 60;
export const SLOW_TITLE = 'Lights are slow';
export const BOT_TITLE = 'Referee bot not running';

/**
 * The issues /healthz's `watch` calls for: each { title (its prefix), open: true with the full title
 * and body, or false to close any open one }. No watch (an older web, or its numbers failed): none.
 */
export function watchIssues(watch) {
  if (!watch) return [];
  const out = [];
  const age = watch.oldest_queued_age_s;
  out.push(age !== null && age !== undefined && age > SLOW_S
    ? { title: SLOW_TITLE, open: true, full: SLOW_TITLE, body: `The oldest attempt waiting to be judged has waited ${Math.round(age / 60)} minutes (over 10).` }
    : { title: SLOW_TITLE, open: false });
  const bot = watch.referee_bot;
  out.push(bot && bot.for_s >= BOT_DOWN_S
    ? { title: BOT_TITLE, open: true, full: `${BOT_TITLE}: ${bot.not_running}`, body: `/ops has said "Referee bot not running: ${bot.not_running}" for 10 minutes or more. Its close calls and benches get three white lights until it's back.` }
    : { title: BOT_TITLE, open: false });
  return out;
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
  const issues = (await gh('/issues?state=open&per_page=100')).filter(i => !i.pull_request);
  const open = issues.filter(i => i.title.startsWith(TITLE));
  if (r.ok) {
    for (const w of watchIssues(r.watch)) {
      const mine = issues.filter(i => i.title.startsWith(w.title));
      if (w.open && !mine.length) await gh('/issues', { method: 'POST', body: JSON.stringify({ title: w.full, body: `${w.body}\n\nSeen at ${new Date().toISOString()}.` }) });
      if (!w.open) for (const i of mine) {
        await gh(`/issues/${i.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `Cleared at ${new Date().toISOString()}.` }) });
        await gh(`/issues/${i.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
      }
    }
    for (const i of open) {
      await gh(`/issues/${i.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `Back up at ${new Date().toISOString()}.` }) });
      await gh(`/issues/${i.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
    }
    console.log('up');
    return;
  }
  console.log(`down: ${r.part}`);
  if (!open.length) {
    await gh('/issues', { method: 'POST', body: JSON.stringify({ title: `${TITLE}: ${r.part}`, body: `${HEALTH_URL} failed twice, 60 s apart (each given ${WAIT_MS / 1000} s to answer), at ${new Date().toISOString()}.` }) });
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
