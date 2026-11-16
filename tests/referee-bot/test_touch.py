"""The committed check on the bench's frames (plan 3.4d step 1, "the bar path first").

On every bench in `calls.json` with a reference track (`tests/bench-commands/data/reference/`, CSRT, not the
phone's tracker), the frames sent (`frames.json`, from `recut.py`) must hold every frame within 0.2 s of the
reference's lowest point from Start! to Press! (or Rack!). It checks what the bot sees, not where the frames job put
its touch: two trackers can disagree about where the bar stopped (IA0P rep 2), and the frames must show both.

`calls.json` and `frames/frames.json` are committed with Walker's yes to item 107; until then this skips, unless
REFEREE_SET points at a built set (`build-set.ts --out`) and REFEREE_FRAMES at the folder `recut.py --out` wrote.

    python3 -m unittest discover tests/referee-bot
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
sys.path.insert(0, os.path.join(ROOT, 'worker'))

import bench_path  # noqa: E402  (stdlib only: no MediaPipe needed)

REFS = os.path.join(ROOT, 'tests', 'bench-commands', 'data', 'reference')
CALLS = os.environ.get('REFEREE_SET') or os.path.join(HERE, 'calls.json')
FRAMES = os.path.join(os.environ.get('REFEREE_FRAMES') or os.path.join(HERE, 'frames'), 'frames.json')
AROUND_MS = 200
FRAME_MS = 1000 / 15   # the server's frames


def reference(a):
    """The reference track for an attempt: by its id's base (meet benches) or its source (gym sets)."""
    for name in (a['id'].split('-')[0], a['source']):
        p = os.path.join(REFS, f'{name}.json')
        if os.path.exists(p):
            with open(p) as f:
                return json.load(f)
    return None


def reference_low(ref, a):
    """The reference's lowest point (largest y), in ms from the attempt's start, from Start! to Press! (or Rack!)."""
    b = a['bench']
    w0 = a['window_ms'][0]
    end = b['press_ms'] if b['press_ms'] is not None else b['rack_ms']
    pts = [(t * 1000 - w0, y) for t, y in zip(ref['t'], ref['y']) if b['start_ms'] <= t * 1000 - w0 <= end]
    return max(pts, key=lambda p: p[1])[0] if len(pts) >= 3 else None


def touches(attempts):
    """[(attempt, way, touch, reference low)] for every bench with a reference. The wrists aren't needed to tell
    whether the path is usable: with none, a bench whose path isn't usable comes out 'window'."""
    out = []
    for a in attempts:
        b = a.get('bench')
        if not b:
            continue
        ref = reference(a)
        if ref is None:
            continue
        dur = a['window_ms'][1] - a['window_ms'][0]
        how = bench_path.bench_way(b.get('path'), lambda: [], b['start_ms'], b['press_ms'], b['rack_ms'], dur)
        out.append((a, how['way'], how['touch'], reference_low(ref, a)))
    return out


def missing(times, low, length):
    """Where the sent frames leave a gap of more than a frame within 0.2 s of `low` (clipped to the cut)."""
    a, b = max(0, low - AROUND_MS), min(length, low + AROUND_MS)
    near = sorted(t for t in times if a - FRAME_MS <= t <= b + FRAME_MS)
    edges = [a - FRAME_MS / 2] + near + [b + FRAME_MS / 2]
    return [(round(x), round(y)) for x, y in zip(edges, edges[1:]) if y - x > 1.5 * FRAME_MS and y > a and x < b]


@unittest.skipUnless(os.path.exists(CALLS) and os.path.exists(FRAMES),
                     'calls.json and frames.json wait for Walker\'s yes to item 107 (or set REFEREE_SET and REFEREE_FRAMES)')
class FramesShowTheTouch(unittest.TestCase):

    def test_every_frame_within_0_2_s_of_the_references_lowest_point_is_sent(self):
        with open(CALLS) as f:
            attempts = json.load(f)['attempts']
        with open(FRAMES) as f:
            frames = json.load(f)['attempts']
        rows = [r for r in touches(attempts) if r[3] is not None]
        self.assertTrue(rows, 'no bench has a reference')
        gaps = []
        for a, _, _, low in rows:
            times = [x['t_ms'] for x in frames[a['id']]['frames']]
            if (g := missing(times, low, a['window_ms'][1] - a['window_ms'][0])):
                gaps.append((a['id'], round(low), g))
        self.assertEqual(gaps, [], 'frames missing near the reference\'s touch: mail The Playner before any paid run')


class Missing(unittest.TestCase):
    """The gap finder itself, on made-up frame times."""

    def test_every_frame_passes_and_one_dropped_frame_fails(self):
        every = [round(i * FRAME_MS) for i in range(90)]
        self.assertEqual(missing(every, 3000, 6000), [])
        self.assertTrue(missing([t for t in every if t != 3067], 3000, 6000))
        self.assertTrue(missing([t for t in every if t != 2800], 3000, 6000))   # the first frame inside 0.2 s

    def test_only_the_2_a_second_frames_fail_and_the_cuts_end_is_allowed(self):
        self.assertTrue(missing(list(range(0, 6001, 500)), 3000, 6000))
        every = [round(i * FRAME_MS) for i in range(76)]   # to 5000 ms
        self.assertEqual(missing(every, 4900, 5000), [])


if __name__ == '__main__':
    unittest.main()
