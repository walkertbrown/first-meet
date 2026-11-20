"""Recount every line of the referee bot test (plan 3.4d step 11) from the committed answers alone.

No key, no frames and no product code: only calls.json (the by-eye answer key), holdout.json and the
results that run.ts wrote. Anyone can run it:

  python3 tests/referee-bot/score.py --set tests/referee-bot/calls.json tests/referee-bot/results/run-1.json
  python3 tests/referee-bot/score.py --set tests/referee-bot/calls.json final-1.json final-2.json

Given two results files (the final runs), each is scored on its own and on its held-back attempts
alone, and the lamps that differ between the two are counted. Exit code 0 only if every line passes.
"""
import argparse
import hashlib
import json
import math
import os
import statistics
import sys

# Step 10's prices, dollars a million tokens: Opus 5.5 at $4 in and $20 out; a cache write is
# 1.25x the input price and a cache read $0.20.
PRICE = {'input': 4.0, 'cache_write': 5.0, 'cache_read': 0.20, 'output': 20.0}
MODEL = 'claude-opus-5-5'
MEDIAN_LIMIT_MS = 120_000
# 5.33 and item 107: on a lost bar the bot is told the phone lost it, with no pause figure and no sinking line
LOST_FORBIDDEN = ('- Pause: the bar was still', '- The phone called Press! while the bar was still going down')
# Item 113 (3.4b, the smoothing test's "The lines"): the three real pauses on the eye check's line with no bad frame.
# Their lamps are printed with the recorded planted cuts' (VibeSearch and The Playner, Nov 20, 10:01-10:03 AM).
ON_THE_LINE = ('AMih', 'ak3m3', '83WA-r2')


def sha256(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def is_red(key):
    return key.startswith('red')


def carries_press(a):
    """A bench with a Press! in its commands: the meet reds and every lost-track cut (item 107)."""
    ct = a.get('command_times') or {}
    return isinstance(ct.get('press'), (int, float)) or isinstance(ct.get('press_late'), (int, float))


def bench(a):
    return a['lift'] == 'bench' and a['division'] == 'barbell'


def lost(a):
    return a.get('cut') == 'lost' or (a.get('command_times') or {}).get('press_late_why') == 'lost'


def pause_lost(a):
    return bool((a.get('measures') or {}).get('pause_lost'))


def cost_of(c):
    return (c['input'] * PRICE['input'] + c['cache_write'] * PRICE['cache_write']
            + c['cache_read'] * PRICE['cache_read'] + c['output'] * PRICE['output']) / 1e6


def cache_ok(row):
    """The left lamp writes the frames to the cache; the head and right lamps read it and never write it again."""
    calls = row.get('calls') or []
    left = [c for c in calls if c['lamp'] == 'left' and c.get('model')]
    written = max((c['cache_write'] for c in left), default=0)
    if written <= 0:
        return False, 'the left lamp wrote nothing to the cache'
    for lamp in ('head', 'right'):
        answered = [c for c in calls if c['lamp'] == lamp and c.get('model')]
        if not answered:
            return False, f'no answered {lamp} call'
        for c in answered:
            if c['cache_read'] <= 0:
                return False, f'{lamp} read nothing from the cache'
            if c['cache_write'] >= written / 2:
                return False, f'{lamp} wrote the frames again ({c["cache_write"]} tokens)'
    return True, ''


def lines(rows, set_by_id, label):
    """Every line of step 11 on these rows. Returns (results, notes): results is [(name, passed, detail)]."""
    out = []
    notes = []
    sure = [r for r in rows if r['key'] != 'either']
    call = {r['id']: r.get('call') for r in rows}  # None on a failed attempt (no three lamps)

    # 1. no wrong light on a sure by-eye call: 1 allowed in the whole set, none among the held-back attempts
    wrong = [r['id'] for r in sure if call[r['id']] is not None and (call[r['id']] == 'red') != is_red(r['key'])]
    allowed = 0 if label == 'held back' else 1
    out.append(('no wrong light on a sure call', len(wrong) <= allowed, f'{len(wrong)} wrong (allowed {allowed}): {", ".join(wrong) or "none"}'))

    # 2. it catches the reds
    reds = [r for r in sure if is_red(r['key'])]
    caught = [r for r in reds if call[r['id']] == 'red']
    need = math.ceil(0.8 * len(reds))
    out.append(('majority red on 80% of sure reds', len(caught) >= need, f'{len(caught)} of {len(reds)} (need {need})'))
    b_reds = [r for r in reds if bench(set_by_id[r['id']])]
    b_caught = [r for r in b_reds if call[r['id']] == 'red']
    need_b = min(3, len(b_reds)) if label == 'held back' else 3
    out.append(('majority red on at least 3 sure bench reds', len(b_caught) >= need_b, f'{len(b_caught)} of {len(b_reds)} (need {need_b})'))
    p_reds = [r for r in b_reds if carries_press(set_by_id[r['id']])]
    p_caught = [r for r in p_reds if call[r['id']] == 'red']
    need_p = math.ceil(0.8 * len(p_reds))
    out.append(('majority red on 80% of sure bench reds with a Press!', len(p_caught) >= need_p,
                f'{len(p_caught)} of {len(p_reds)} (need {need_p}); missed: {", ".join(r["id"] for r in p_reds if call[r["id"]] != "red") or "none"}'))
    lost_whites = [r for r in sure if r['key'] == 'white' and lost(set_by_id[r['id']])]
    lw_red = [r['id'] for r in lost_whites if call[r['id']] == 'red']
    other_wrong = len(wrong) - len(lw_red)
    out.append(('no majority red on a lost-track white (beyond the 1 allowed)', len(lw_red) + other_wrong <= allowed,
                f'{len(lw_red)} of {len(lost_whites)} red: {", ".join(lw_red) or "none"}; with {other_wrong} other wrong lights'))

    # 3. at least 85% of attempts agree ("either" agrees with anything; a failed attempt doesn't agree)
    agree = [r for r in rows if call[r['id']] is not None and (r['key'] == 'either' or (call[r['id']] == 'red') == is_red(r['key']))]
    out.append(('85% of attempts agree', len(agree) >= 0.85 * len(rows), f'{len(agree)} of {len(rows)} ({100 * len(agree) / max(1, len(rows)):.1f}%)'))

    # 4. at least 80% of lamps sure (a failed attempt's three lamps count as not sure)
    lamps = [a for r in rows for a in (r.get('answers') or [])]
    n_lamps = 3 * len(rows)
    sure_lamps = sum(1 for a in lamps if a.get('sure') is True)
    out.append(('80% of lamps sure', sure_lamps >= 0.8 * n_lamps, f'{sure_lamps} of {n_lamps} ({100 * sure_lamps / max(1, n_lamps):.1f}%)'))

    # 5. median time from frames ready to three lamps under 2 minutes
    times = [r['ms'] for r in rows if 'ms' in r]
    med = statistics.median(times) if times else math.inf
    out.append(('median time to three lamps under 2 minutes', len(times) == len(rows) and med < MEDIAN_LIMIT_MS,
                f'median {med / 1000:.1f} s over {len(times)} of {len(rows)}'))

    # 6. the cache works on every attempt
    bad = []
    for r in rows:
        ok, why = cache_ok(r)
        if not ok:
            bad.append(f'{r["id"]} ({why})')
    out.append(('the cache works on every attempt', not bad, f'{len(bad)} without: {"; ".join(bad[:5])}{" ..." if len(bad) > 5 else ""}'))

    # 7. the cost written down matches the tokens at step 10's prices
    off = []
    for r in rows:
        mine = sum(cost_of(c) for c in r.get('calls') or [])
        if abs(mine - r['cost_usd']) > 0.0005 + 0.0001 * len(r.get('calls') or []):
            off.append(f'{r["id"]} (written ${r["cost_usd"]:.4f}, tokens ${mine:.4f})')
    total = sum(cost_of(c) for r in rows for c in r.get('calls') or [])
    out.append(('cost written matches the tokens', not off, f'${total:.2f} at step 10 prices; {len(off)} off: {"; ".join(off[:5])}'))

    # the guard: a lost-track bench, or one whose server path lost or stuck near the pause (item 108), is never sent
    # a pause figure or the sinking line
    leaks = [r['id'] for r in rows if (lost(set_by_id[r['id']]) or pause_lost(set_by_id[r['id']]))
             and any(m.startswith(LOST_FORBIDDEN) for m in r.get('measured') or [])]
    out.append(('no pause figure or sinking line on a lost bar', not leaks, f'{len(leaks)}: {", ".join(leaks) or "none"}'))

    # 3.4d step 11, item 108: "Press! inside a stuck stretch" counts like any bench, and the results name it
    for r in rows:
        if set_by_id[r['id']].get('cut') == 'stuck':
            notes.append(f'Press! inside a stuck stretch: {r["id"]} -> {call[r["id"]] or "failed"} (answer {r["key"]})')

    failed = [r['id'] for r in rows if 'failed' in r]
    if failed:
        notes.append(f'{len(failed)} attempts without three lamps: {", ".join(failed)}')
    models = sorted({c.get('model') for r in rows for c in r.get('calls') or [] if c.get('model')})
    if models and models != [MODEL]:
        notes.append(f'answered by {", ".join(models)}, not only {MODEL}')
    return out, notes


def allowance(rows, set_by_id):
    """Item 113's allowance tried: the lamps on the recorded planted cuts and on the three pauses on the line.

    Returns (lines, reds): a red for the pause (reason no_pause) on any of them goes to The Playner before the bot is
    switched on. It fails no line: the plan sends it to The Playner, not to the score."""
    out, reds = [], []
    for r in rows:
        a = set_by_id[r['id']]
        if not (a.get('recorded') or r['id'] in ON_THE_LINE):
            continue
        answers = r.get('answers') or []
        sent = next((m[2:] for m in r.get('measured') or [] if m.startswith('- Pause')), '(no pause line)')
        lamps = ', '.join(f'{x["lamp"]} {x["light"]}{" (" + x["reason"] + ")" if x.get("reason") else ""}' for x in answers) or 'failed'
        if any(x.get('light') == 'red' and x.get('reason') == 'no_pause' for x in answers):
            reds.append(r['id'])
        eye = a.get('eye_pause_s')
        out.append(f'  {r["id"]:<16} {"recorded" if a.get("recorded") else "counted":<9} eye {eye:.2f} s, sent: {sent}  ->  {lamps}')
    return out, reds


def bench_pause_table(rows, set_by_id):
    """For each bench: the Pause line it was sent, next to the eye's pause (NerdCider, Nov 15)."""
    t = []
    for r in rows:
        if not bench(set_by_id[r['id']]):
            continue
        sent = next((m[2:] for m in r.get('measured') or [] if m.startswith('- Pause') or m.startswith('- Commands')), '(no pause line)')
        eye = r.get('eye_pause_s')
        t.append(f'  {r["id"]:<18} {r["key"]:<16} eye {"-" if eye is None else f"{eye:.2f} s":<8} sent: {sent}  ->  {r.get("call") or "failed"}')
    return t


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--set', required=True, help='calls.json (holdout.json is read from beside it)')
    ap.add_argument('--pauses', action='store_true', help="print each bench's Pause line next to the eye's pause")
    ap.add_argument('results', nargs='+', help="run.ts's results: run 1, or the two final runs")
    o = ap.parse_args()
    if len(o.results) > 2:
        ap.error('one results file (run 1) or two (the final runs)')

    the_set = json.load(open(o.set))
    set_by_id = {a['id']: a for a in the_set['attempts']}
    held = set(json.load(open(os.path.join(os.path.dirname(os.path.abspath(o.set)), 'holdout.json')))['attempts'])
    set_sha = sha256(o.set)
    final = len(o.results) == 2
    passed = True
    runs = []

    for path in o.results:
        res = json.load(open(path))
        rows = res['attempts']
        print(f'\n== {path}  (runs: {res.get("runs")}, model {res.get("model")}, commit {res.get("commit")}, {res.get("at")})')
        if res.get('calls_sha256') != set_sha:
            print('   FAIL: scored against a different calls.json (SHA-256 differs)')
            passed = False
        if res.get('test'):
            print(f'   (a dry run with staging test answers "{res["test"]}": no real lamps, nothing to score for real)')
        ids = [r['id'] for r in rows]
        expected = [a['id'] for a in the_set['attempts'] if final or a['id'] not in held]
        if res.get('runs') == 'held_back':
            expected = [a['id'] for a in the_set['attempts'] if a['id'] in held]
        missing = [i for i in expected if i not in ids]
        if missing:
            print(f'   FAIL: a part run, {len(missing)} attempts missing (a part run is never scored): {", ".join(missing[:8])}')
            passed = False
            continue
        if not final and any(i in held for i in ids) and res.get('runs') != 'held_back':
            print('   FAIL: run 1 includes held-back attempts')
            passed = False
        for r in rows:
            r['key'] = set_by_id[r['id']]['call']  # always the committed key, never the copy in the results
        # a recorded row (item 113's planted cuts) is run and printed, and counted in no line
        counted = [r for r in rows if not set_by_id[r['id']].get('recorded')]
        groups = [('whole set' if final else 'run', counted)]
        if final:
            groups.append(('held back', [r for r in counted if r['id'] in held]))
        for label, rs in groups:
            res_lines, notes = lines(rs, set_by_id, label)
            print(f'   -- {label}: {len(rs)} attempts')
            for name, ok, detail in res_lines:
                print(f'   {"pass" if ok else "FAIL"}  {name}: {detail}')
                passed &= ok
            for n in notes:
                print(f'   note: {n}')
        a_lines, a_reds = allowance(rows, set_by_id)
        if a_lines:
            print("   -- item 113's allowance: the planted cuts (recorded) and the three pauses on the line")
            print('\n'.join(a_lines))
            print(f'   {"TO THE PLAYNER before the bot is switched on: red for the pause on " + ", ".join(a_reds) if a_reds else "no red for the pause on any of them"}')
        print(f'   cost written: ${res.get("cost_usd", 0):.2f}')
        if o.pauses:
            print('   -- each bench: the Pause line it was sent, next to the eye')
            print('\n'.join(bench_pause_table(rows, set_by_id)))
        runs.append({r['id']: r for r in rows})

    if final and len(runs) == 2:
        differ = 0
        total = 0
        for i, r in runs[0].items():
            a = r.get('lights') or [None] * 3
            b = runs[1].get(i, {}).get('lights') or [None] * 3
            total += 3
            differ += sum(1 for x, y in zip(a, b) if x != y)
        print(f'\n== between the two final runs: {differ} of {total} lamps differ')

    print(f'\n{"EVERY LINE PASSES" if passed else "A LINE FAILS"}')
    sys.exit(0 if passed else 1)


if __name__ == '__main__':
    main()
