"""score.py on a small made-up set: each line passes when it should and fails when it should."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import score  # noqa: E402


def attempt(id_, call, lift='bench', division='barbell', ct=None, cut='one'):
    return {'id': id_, 'group': 'g', 'lift': lift, 'division': division, 'call': call, 'cut': cut,
            'command_times': ct if ct is not None else {'loaded': 0, 'start': 1000, 'rack': 5000}}


def calls(left_write=10_000, head_write=0, read=10_000):
    out = []
    for lamp, write, rd in (('left', left_write, 0), ('head', head_write, read), ('right', 0, read)):
        c = {'lamp': lamp, 'try': 1, 'model': score.MODEL, 'stop': 'end_turn', 'input': 500, 'cache_write': write,
             'cache_read': rd, 'output': 2000}
        c['cost_usd'] = round(score.cost_of(c), 5)
        out.append(c)
    return out


def row(id_, lights, sure=True, ms=30_000, measured=None, **kw):
    cs = kw.pop('calls', None) or calls()
    return {'id': id_, 'group': 'g', 'key': '?', 'lights': lights,
            'call': 'white' if lights.count('white') >= 2 else 'red',
            'answers': [{'lamp': l, 'light': x, 'sure': sure} for l, x in zip(('left', 'head', 'right'), lights)],
            'ms': ms, 'calls': cs, 'cost_usd': round(sum(c['cost_usd'] for c in cs), 4), 'measured': measured or []}


SET = [
    attempt('w1', 'white'), attempt('w2', 'white'), attempt('w3', 'white'),
    attempt('r1', 'red:no_pause'), attempt('r2', 'red:no_pause'), attempt('r3', 'red:no_pause'),
    attempt('p1', 'red:no_pause', ct={'loaded': 0, 'start': 1000, 'press_late': 3000, 'press_late_why': 'lost', 'rack': 6000}, cut='lost'),
    attempt('lw', 'white', ct={'loaded': 0, 'start': 1000, 'press_late': 3000, 'press_late_why': 'lost', 'rack': 6000}, cut='lost'),
    attempt('e1', 'either', lift='squat', division='home'),
]
W, R = ['white'] * 3, ['red'] * 3
GOOD = [row('w1', W), row('w2', W), row('w3', W), row('r1', R), row('r2', R), row('r3', R), row('p1', R), row('lw', W), row('e1', R)]


def result(rows):
    for r in rows:
        r['key'] = next(a['call'] for a in SET if a['id'] == r['id'])
    by = {a['id']: a for a in SET}
    out, _ = score.lines(rows, by, 'run')
    return {name: ok for name, ok, _ in out}


class ScoreLines(unittest.TestCase):
    def test_a_good_run_passes_every_line(self):
        got = result([dict(r) for r in GOOD])
        self.assertTrue(all(got.values()), got)

    def test_all_white_fails_the_catch_lines(self):
        got = result([row(r['id'], W) for r in GOOD])
        self.assertFalse(got['majority red on 80% of sure reds'])
        self.assertFalse(got['majority red on at least 3 sure bench reds'])
        self.assertFalse(got['majority red on 80% of sure bench reds with a Press!'])

    def test_two_wrong_lights_fail_one_is_allowed(self):
        one = [dict(r) for r in GOOD]
        one[0] = row('w1', R)
        self.assertTrue(result(one)['no wrong light on a sure call'])
        two = [dict(r) for r in one]
        two[1] = row('w2', R)
        self.assertFalse(result(two)['no wrong light on a sure call'])

    def test_a_red_on_a_lost_track_white_counts_against_the_one_allowed(self):
        rows = [dict(r) for r in GOOD]
        rows[0] = row('w1', R)
        rows[7] = row('lw', R)
        self.assertFalse(result(rows)['no majority red on a lost-track white (beyond the 1 allowed)'])

    def test_the_cache_line(self):
        rows = [dict(r) for r in GOOD]
        rows[2] = row('w3', W, calls=calls(head_write=10_000))
        self.assertFalse(result(rows)['the cache works on every attempt'])
        rows[2] = row('w3', W, calls=calls(read=0))
        self.assertFalse(result(rows)['the cache works on every attempt'])

    def test_the_cost_must_match_the_tokens(self):
        rows = [dict(r) for r in GOOD]
        rows[3] = dict(row('r1', R), cost_usd=0.01)
        self.assertFalse(result(rows)['cost written matches the tokens'])

    def test_unsure_lamps_and_slow_answers(self):
        rows = [row(r['id'], r['lights'], sure=False) for r in GOOD]
        self.assertFalse(result(rows)['80% of lamps sure'])
        rows = [row(r['id'], r['lights'], ms=130_000) for r in GOOD]
        self.assertFalse(result(rows)['median time to three lamps under 2 minutes'])

    def test_a_lost_bar_sent_a_pause_figure_fails(self):
        rows = [dict(r) for r in GOOD]
        rows[6] = row('p1', R, measured=['- Pause: the bar was still 0.4 s before Press!'])
        self.assertFalse(result(rows)['no pause figure or sinking line on a lost bar'])

    def test_the_cli_refuses_a_part_run_and_a_different_set(self):
        with tempfile.TemporaryDirectory() as d:
            set_path = os.path.join(d, 'calls.json')
            with open(set_path, 'w') as f:
                json.dump({'attempts': SET}, f)
            with open(os.path.join(d, 'holdout.json'), 'w') as f:
                json.dump({'attempts': ['w3']}, f)
            sha = score.sha256(set_path)
            rows = [dict(r) for r in GOOD if r['id'] != 'w3']
            run = os.path.join(d, 'run-1.json')
            with open(run, 'w') as f:
                json.dump({'calls_sha256': sha, 'runs': 'run_1', 'attempts': rows}, f)
            ok = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'score.py'), '--set', set_path, run], capture_output=True, text=True)
            self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
            with open(run, 'w') as f:
                json.dump({'calls_sha256': sha, 'runs': 'run_1', 'attempts': rows[:-1]}, f)
            part = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'score.py'), '--set', set_path, run], capture_output=True, text=True)
            self.assertEqual(part.returncode, 1)
            self.assertIn('a part run', part.stdout)
            with open(run, 'w') as f:
                json.dump({'calls_sha256': '0' * 64, 'runs': 'run_1', 'attempts': rows}, f)
            other = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'score.py'), '--set', set_path, run], capture_output=True, text=True)
            self.assertEqual(other.returncode, 1)
            self.assertIn('different calls.json', other.stdout)


if __name__ == '__main__':
    unittest.main()
