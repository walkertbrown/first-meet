// The referee bot test's run (plan 3.4d step 11): each attempt in the set, asked exactly as the product asks.
// The words come from bot.ts's attemptWords, the cached prefix from its buildPrefix (prompt.md and the frames),
// the three lamps from lamps.ts's askLamps and the client from makeClient: the same code the worker runs.
// Each frame is read from recut.py's JPEGs and must match frames.json's SHA-256 before anything is sent.
//
// Usage (from the repo root):
//   TSX_TSCONFIG_PATH=web/tsconfig.json npx tsx tests/referee-bot/run.ts --set tests/referee-bot/calls.json \
//     --frames <recut.py --out folder> --out tests/referee-bot/results/run-1.json [--holdout | --all] [--test red_white_white] [--only ID,...]
// Run 1 skips the held-back attempts (holdout.json); --holdout runs only them; --all (the final runs) runs the whole set.
// --test fakes only Anthropic's answers (lamps.ts's staging test answers), so the whole path runs with no key and no cost.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { attemptWords, buildPrefix, makeClient } from '../../web/lib/referee/bot';
import { askLamps, lampAsker, MODEL, TEST_ANSWERS, type TestAnswers } from '../../web/lib/referee/lamps';
import { refereeReasons } from '../../web/lib/reason-words';
import { callOf } from '../../web/lib/lights';
import type { RefereeFrame } from '../../web/db/schema';

export type SetAttempt = {
  id: string; group: string; lift: 'squat' | 'bench' | 'deadlift'; division: 'barbell' | 'home';
  weight: number; units: 'kg' | 'lb'; reps_declared: number | null; reason: string; measures?: Record<string, unknown> | null;
  command_times: Record<string, number> | null;
  /** The answer key: 'white', 'red:<reason>' or 'either'. */
  call: string;
  /** Bench: the eye's pause (s), shown in the results next to the pause line the bot was sent. */
  eye_pause_s?: number | null;
};

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

export const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

async function main() {
  const setPath = arg('set'); const framesDir = arg('frames'); const outPath = arg('out');
  if (!setPath || !framesDir || !outPath) throw new Error('--set, --frames and --out are needed');
  const setRaw = readFileSync(setPath);
  const set: { attempts: SetAttempt[] } = JSON.parse(setRaw.toString('utf8'));
  const frames: { set_sha256: string; attempts: Record<string, { frames: { n: number; t_ms: number; sha256: string }[] }> } =
    JSON.parse(readFileSync(join(framesDir, 'frames.json'), 'utf8'));
  if (frames.set_sha256 !== sha(setRaw)) throw new Error('frames.json was cut from a different set file: run recut.py again');
  const holdout: string[] = JSON.parse(readFileSync(join(dirname(setPath), 'holdout.json'), 'utf8')).attempts;
  const heldBack = process.argv.includes('--holdout');
  const all = process.argv.includes('--all');
  if (all && heldBack) throw new Error('--all or --holdout, not both');
  const only = arg('only')?.split(',');
  const test = (arg('test') ?? null) as TestAnswers | null;
  if (test && !(TEST_ANSWERS as readonly string[]).includes(test)) throw new Error(`--test is one of ${TEST_ANSWERS.join(', ')}`);
  const client = test ? null : makeClient();
  if (!test && !client) throw new Error('no ANTHROPIC_API_KEY (or pass --test for a dry run)');

  const rows = [];
  for (const a of set.attempts) {
    if (only ? !only.includes(a.id) : !all && holdout.includes(a.id) !== heldBack) continue;
    const got = frames.attempts[a.id];
    if (!got) throw new Error(`${a.id}: not in frames.json`);
    // the store the prefix reads: recut.py's JPEGs, each checked against its hash
    const store = {
      get: async (key: string) => {
        const f = got.frames[Number(key)];
        const jpg = readFileSync(join(framesDir, 'jpeg', a.id, `${String(f.n).padStart(2, '0')}.jpg`));
        if (sha(jpg) !== f.sha256) throw new Error(`${a.id} frame ${f.n}: not the frame recut.py made`);
        return new Response(jpg);
      },
    };
    const refFrames: RefereeFrame[] = got.frames.map(f => ({ n: f.n, t_ms: f.t_ms, key: String(f.n), sha256: f.sha256 }));
    const bench = a.lift === 'bench' && a.division === 'barbell';
    const home = !!a.reps_declared;
    const words = attemptWords({
      lift: a.lift, division: a.division, ageGroup: null, weight: a.weight, units: a.units, repsDeclared: a.reps_declared,
      reason: a.reason, measures: a.measures ?? null, commandTimes: a.command_times, bench, frames: refFrames.length,
    });
    const prefix = await buildPrefix(store, words, refFrames);
    const reasons = refereeReasons(a.lift, a.division);
    const redReason = a.lift === 'squat' ? 'depth' : bench ? 'no_pause' : 'no_lockout';
    // what the judge measured, as sent (NerdCider, Nov 15): the bench's pause line sits next to the eye's pause in the results
    const measured = words.split('\n').filter(l => l.startsWith('- '));
    const t0 = Date.now();
    const out = await askLamps(lampAsker({ client, prefix, test, home, reasons, redReason }));
    const cost = out.calls.reduce((s, c) => s + c.cost_usd, 0);
    const row = out.kind === 'lamps'
      ? {
          id: a.id, group: a.group, key: a.call, held_back: holdout.includes(a.id), eye_pause_s: a.eye_pause_s ?? null, measured, frames: refFrames.length, words,
          lights: out.lamps.map(l => l.answer.light), call: callOf(out.lamps.map(l => l.answer.light)),
          answers: out.lamps.map(l => ({ lamp: l.lamp, ...l.answer })), cost_usd: +cost.toFixed(4), ms: Date.now() - t0, calls: out.calls,
        }
      : { id: a.id, group: a.group, key: a.call, held_back: holdout.includes(a.id), eye_pause_s: a.eye_pause_s ?? null, measured, frames: refFrames.length, words, failed: out.why, cost_usd: +cost.toFixed(4), calls: out.calls };
    rows.push(row);
    console.log(`${a.id} (${a.call}): ${out.kind === 'lamps' ? `${out.lamps.map(l => l.answer.light).join(' ')} -> ${callOf(out.lamps.map(l => l.answer.light))}` : `failed: ${out.why}`}, $${row.cost_usd}`);
  }
  let commit: string | null = null;
  try { commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({
    calls_sha256: sha(setRaw), prompt_sha256: sha(readFileSync(join(__dirname, '../../web/lib/referee/prompt.md'))),
    model: MODEL, test, runs: all ? 'all' : heldBack ? 'held_back' : only ? 'only' : 'run_1', commit, at: new Date().toISOString(),
    cost_usd: +rows.reduce((s, r) => s + r.cost_usd, 0).toFixed(4), attempts: rows,
  }, null, 1));
}

if (require.main === module) main().catch(e => { console.error(e.message ?? e); process.exit(1); });
