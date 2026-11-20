"""Each Pause line against the eye (plan 3.4d step 11, item 110; VibeSearch, Nov 20, 8:20 AM).

Fails if a bench whose eye's pause is 0.5 s or more is sent a Pause line under 0.3 s, or one whose eye's pause is
under 0.3 s is sent 0.5 s or more. "Not measured" (and no Pause line at all) never fails it. It runs before any paid
run, so the bot is never sent "0.0 s" on a real pause.

The lines come from `pauses.ts`: every bench of the set, measured on the phone's own path as takeBar does, at 30, 20
and 15 fps cameras, each on the grid, at the live tick and fed 3 times, and with one bad frame planted in each real
pause, 0.05 lower and higher (3.4b, "The smoothing is in time, not points"). Each planted run's Pause line must stay
moved by more than one camera frame from the same camera and tick unplanted is printed, not failed: on a bar still
sinking into her stop the 5% band's edge moves with any small change in y (z838, ak3m3; 3.4b, the smoothing test's "The
lines", Nov 20, 9:58 AM). The hard line on a planted run is the eye check.

8qzW rep 1 is recorded, not checked (Nov 20, 8:44 AM): its number is printed on every run, so a change shows. At 15 fps
with a frame 0.05 higher it's sent "still 0.0 s" on 0.67 s, the second allowed miss (VibeSearch, 10:01 AM).

KNOWN holds the one allowed miss of the eye check: ak3m3 at 15 fps, 0.05 lower, on all three ticks. Any other miss
fails, and so does a known one that stops missing, so the list never goes stale.

Item 113: IA0P rep 2 (its track froze through the pause) and IA0P-r3-stuck read "not measured" on every camera, tick
and plant, since item 108's guard carries a stuck stretch through one off camera frame. And no real pause of 0.5 s or
more by eye that's measured on the recorded trace reads "not measured" on any run (LOST_REAL is empty: the carry holds
only on a frozen track's motion, 3.4b). KrDo rep 1's is pinned measured at every camera, tick and plant.

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

# (bench, camera, tick, plant): the planted runs allowed to miss the eye check. A plant of 0 is never here: the
# unplanted runs have no known misses.
_TICKS = ('grid', 'tick', 'three')
KNOWN = {
    # the bar still sinks slowly into her stop: at 15 fps the median takes a neighbour's y, and the pause's start moves
    # one frame (0.30 to 0.23 s), under 0.3 s on a 0.5 s pause (3.4b: the allowed miss)
    **{('ak3m3', 15, t, 0.05): 'eye' for t in _TICKS},
}
# item 113: read "not measured" on every run
STUCK = ('IA0P-r2', 'IA0P-r3-stuck')
# NerdCider's third check on item 113 (10:00 AM): a real pause of 0.5 s or more by eye that's measured at 30 fps on the
# grid, unplanted, is measured on every run. None is allowed to read "not measured" (The Playner, Nov 20, 10:13 AM:
# KrDo at 15 fps was, until the carry went on a frozen track's motion only), so the list is empty.
LOST_REAL = set()

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
    """{(bench, camera, tick, plant): (kind, why)} for every checked row that misses: 'eye' against the eye (fails
    unless known), 'frame' a planted line more than a camera frame from the unplanted one (printed)."""
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


def key(k):
    return f'{k[0]} at {k[1]} fps, {k[2]}, planted {k[3]:+.2f}'


def lost_real():
    """{(bench, camera, tick, plant)} where a real pause of 0.5 s or more by eye, measured on the recorded trace, reads
    "not measured"."""
    rs = runs()
    measured = {x['id'] for x in rs[0]['rows'] if (x['eye_pause_s'] or 0) >= 0.5 and x['pause_s'] is not None}
    return {(x['id'], r['camera'], r['tick'], r['plant']) for r in rs for x in r['rows'] if x['id'] in measured and x['pause_s'] is None}


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
        eye = {k: why for k, (kind, why) in m.items() if kind == 'eye'}
        moved_ = {k: why for k, (kind, why) in m.items() if kind == 'frame'}
        order = lambda kv: (kv[0][0], -kv[0][1], kv[0][2], kv[0][3])  # noqa: E731
        if eye:
            print(f'\n   -- test_pause.py: {len(eye)} allowed misses of the eye check (3.4b)', file=sys.stderr)
            for k, why in sorted(eye.items(), key=order):
                print(f'      {key(k)}: {why}', file=sys.stderr)
        if moved_:
            print(f'\n   -- test_pause.py: {len(moved_)} planted lines more than a camera frame from unplanted, within the eye check (recorded)', file=sys.stderr)
            for k, why in sorted(moved_.items(), key=order):
                print(f'      {key(k)}: {why}', file=sys.stderr)
        new = [f'{key(k)}: {why}' for k, why in eye.items() if k not in KNOWN]
        gone = [key(k) for k in KNOWN if k not in eye]
        self.assertEqual(new, [], 'new misses of the eye check:\n' + '\n'.join(new))
        self.assertEqual(gone, [], 'known misses that no longer miss (take them out of KNOWN):\n' + '\n'.join(gone))

    def test_the_stuck_tracks_read_not_measured_on_every_run(self):
        # item 113: one off camera frame no longer lets a pause be measured on a frozen track
        bad = [f'{x["id"]} at {name(r)}: {x["pause_s"]} s' for r in runs() for x in r['rows']
               if x['id'] in STUCK and x['pause_s'] is not None]
        self.assertEqual(bad, [], '\n'.join(bad))
        self.assertEqual({x['id'] for r in runs() for x in r['rows'] if x['id'] in STUCK}, set(STUCK))

    def test_no_real_pause_newly_reads_not_measured(self):
        got = lost_real()
        if got:
            print(f'\n   -- test_pause.py: {len(got)} runs where a real pause of 0.5 s or more reads "not measured", with The Playner', file=sys.stderr)
            for k in sorted(got, key=lambda k: (k[0], -k[1], k[2], k[3])):
                print(f'      {key(k)}', file=sys.stderr)
        self.assertEqual(sorted(got - LOST_REAL), [], 'new real pauses read "not measured"')
        self.assertEqual(sorted(LOST_REAL - got), [], 'known ones that are measured again (take them out of LOST_REAL)')

    def test_measured_real_pauses_stay_measured_at_every_camera(self):
        # the pin (The Playner, 10:13 AM): the real pauses of 0.5 s or more measured on the recorded trace, KrDo's among
        # them, are measured on all 27 runs
        measured = {x['id'] for x in runs()[0]['rows'] if (x['eye_pause_s'] or 0) >= 0.5 and x['pause_s'] is not None}
        self.assertIn('KrDo', {i.split('-')[0] for i in measured})
        for r in runs():
            for x in r['rows']:
                if x['id'] in measured:
                    self.assertIsNotNone(x['pause_s'], f'{x["id"]} at {name(r)}')

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
