"""Each Pause line against the eye (plan 3.4d step 11, item 110; VibeSearch, Nov 20, 8:20 AM).

Fails if a bench whose eye's pause is 0.5 s or more is sent a Pause line under 0.3 s, or one whose eye's pause is
under 0.3 s is sent 0.5 s or more. "Not measured" (and no Pause line at all) never fails it. It runs before any paid
run, so the bot is never sent "0.0 s" on a real pause.

The lines come from `pauses.ts`: every bench of the set, measured on the phone's own path as takeBar does, at 30, 20
and 15 fps cameras, each on the grid, at the live tick and fed 3 times, and with one bad frame planted in each real
pause, 0.05 lower and higher (3.4b, "The smoothing is in time, not points"). Each planted run's Pause line must stay
within one camera frame of the same camera and tick unplanted (pause_s is rounded to 0.01 s, so 10 ms more).

8qzW rep 1 is recorded, not checked (Nov 20, 8:44 AM): its number is printed on every run, so a change shows.

KNOWN holds the planted runs that miss today, sent to The Playner to rule on (Nov 20): each is printed on every run,
and any miss not in it fails. A known miss that stops missing fails too, so the list never goes stale.

    python3 -m unittest discover tests/referee-bot
"""
import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
RECORDED = ('8qzW-r1',)

# (bench, camera, tick, plant): the planted runs that miss today, by kind ('eye': against the eye; 'frame': more than a
# camera frame from the unplanted run). A plant of 0 is never here: the unplanted runs have no known misses.
_TICKS = ('grid', 'tick', 'three')
KNOWN = {
    # the bar still sinks slowly into her stop: at 15 fps the 3-point median takes a neighbour's y, and the pause's
    # start moves one frame (0.30 to 0.23 s), under 0.3 s on a 0.5 s pause
    **{('ak3m3', 15, t, 0.05): 'eye' for t in _TICKS},
    # the bar creeps 0.018 of the frame down through the eye's pause; the median's low before Press! rises 0.002
    # against a 5% band of about 0.0025, so the pause moves 0.13-0.20 s
    ('z838-r1', 30, 'tick', 0.05): 'frame',
    **{('z838-r1', 20, t, 0.05): 'frame' for t in _TICKS},
    ('z838-r1', 15, 'tick', 0.05): 'frame',
    # the phone's track froze through the pause (item 108 marks it lost): one planted frame splits the frozen stretch,
    # the guard no longer catches it, and a pause is measured on a stuck track
    **{('IA0P-r2', 20, 'grid', d): 'frame' for d in (0.05, -0.05)},
    **{('IA0P-r2', 15, t, d): 'frame' for t in _TICKS for d in (0.05, -0.05)},
    **{('IA0P-r3-stuck', 20, 'grid', d): 'frame' for d in (0.05, -0.05)},
    # 0.95 to 1.0 s at the tick, 50 ms on a 33 ms frame
    ('uGCh', 30, 'tick', -0.05): 'frame',
}

_runs = None


def runs():
    """pauses.ts's runs, once per test run."""
    global _runs
    if _runs is None:
        env = dict(os.environ, TSX_TSCONFIG_PATH='web/tsconfig.json')
        out = subprocess.run(['npx', '--no-install', 'tsx', 'tests/referee-bot/pauses.ts'], cwd=ROOT, env=env,
                             capture_output=True, text=True, timeout=300)
        if out.returncode != 0:
            raise RuntimeError(f'pauses.ts failed:\n{out.stderr[-2000:]}')
        _runs = json.loads(out.stdout)['runs']
    return _runs


def against_eye(row):
    """Why this row's Pause line fails against the eye, or None."""
    eye, sent = row['eye_pause_s'], row['sent_s']
    if sent is None or eye is None:
        return None
    if eye >= 0.5 and sent < 0.3:
        return f'eye {eye:.2f} s, sent {sent:.1f} s (under 0.3 s on a pause of 0.5 s or more)'
    if eye < 0.3 and sent >= 0.5:
        return f'eye {eye:.2f} s, sent {sent:.1f} s (0.5 s or more on a pause under 0.3 s)'
    return None


def moved(row, base, fps):
    """Why a planted row is more than one camera frame from the unplanted one, or None."""
    a, b = base['pause_s'], row['pause_s']
    if (a is None) != (b is None):
        return f'{"not measured" if a is None else a} unplanted, {"not measured" if b is None else b} planted'
    if a is not None and abs(a - b) * 1000 > 1000 / fps + 10:
        return f'{a:.2f} s unplanted, {b:.2f} s planted ({abs(a - b) * 1000:.0f} ms, a frame is {1000 / fps:.0f} ms)'
    return None


def name(r):
    plant = 'unplanted' if not r['plant'] else f'planted {r["plant"]:+.2f}'
    return f'{r["camera"]} fps, {r["tick"]}, {plant}'


def misses():
    """{(bench, camera, tick, plant): (kind, why)} for every checked row that misses."""
    rs = runs()
    base = {(r['camera'], r['tick']): {x['id']: x for x in r['rows']} for r in rs if not r['plant']}
    out = {}
    for r in rs:
        for x in r['rows']:
            if x['id'].startswith(RECORDED):
                continue
            k = (x['id'], r['camera'], r['tick'], r['plant'])
            why = against_eye(x)
            if why:
                out[k] = ('eye', why)
            elif r['plant']:
                why = moved(x, base[(r['camera'], r['tick'])][x['id']], r['camera'])
                if why:
                    out[k] = ('frame', why)
    return out


class PauseAgainstEye(unittest.TestCase):
    def test_runs_cover_every_camera_tick_and_plant(self):
        got = {(r['camera'], r['tick'], r['plant']) for r in runs()}
        self.assertEqual(got, {(c, t, p) for c in (30, 20, 15) for t in _TICKS for p in (0, 0.05, -0.05)})
        # the 14 benches with a Press! on a pause of 0.5 s or more by eye are sent a number on the recorded trace (IA0P
        # rep 2's frozen track reads "not measured", and the lost-track cuts never have one), so the check has
        # something to bite on, and a line blanked shows here
        whites = [x['id'] for x in runs()[0]['rows'] if (x['eye_pause_s'] or 0) >= 0.5 and x['sent_s'] is not None]
        self.assertEqual(len(whites), 14, whites)

    def test_unplanted_every_line_against_the_eye(self):
        bad = [f'{x["id"]} at {name(r)}: {against_eye(x)}' for r in runs() if not r['plant'] for x in r['rows']
               if not x['id'].startswith(RECORDED) and against_eye(x)]
        self.assertEqual(bad, [], '\n'.join(bad))

    def test_planted_runs_only_the_known_misses(self):
        m = misses()
        new = [f'{k[0]} at {k[1]} fps, {k[2]}, planted {k[3]:+.2f}: {why}' for k, (kind, why) in m.items() if KNOWN.get(k) != kind]
        gone = [f'{k[0]} at {k[1]} fps, {k[2]}, planted {k[3]:+.2f} ({kind})' for k, kind in KNOWN.items() if m.get(k, (None,))[0] != kind]
        if m:
            print(f'\n   -- test_pause.py: {len(m)} known planted misses, with The Playner to rule on', file=sys.stderr)
            for k, (kind, why) in sorted(m.items(), key=lambda kv: (kv[0][0], -kv[0][1], kv[0][2], kv[0][3])):
                print(f'      {k[0]} at {k[1]} fps, {k[2]}, planted {k[3]:+.2f}: {why}', file=sys.stderr)
        self.assertEqual(new, [], 'new misses:\n' + '\n'.join(new))
        self.assertEqual(gone, [], 'known misses that no longer miss (take them out of KNOWN):\n' + '\n'.join(gone))

    def test_8qzw_rep_1_is_recorded(self):
        line = []
        for r in runs():
            x = next(x for x in r['rows'] if x['id'] == '8qzW-r1')
            line.append(f'{r["camera"]}/{r["tick"]}/{r["plant"]:+.2f} {x["pause_s"]}')
        print('\n   -- test_pause.py: 8qzW rep 1 (eye 0.67 s), recorded, not checked: ' + ', '.join(line), file=sys.stderr)
        grid = next(x for x in runs()[0]['rows'] if x['id'] == '8qzW-r1')
        self.assertIsNotNone(grid['line'])


if __name__ == '__main__':
    unittest.main()
