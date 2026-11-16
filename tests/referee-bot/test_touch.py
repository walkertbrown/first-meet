"""The committed check on the bench's touch (plan 3.4d step 1, "the bar path first").

On every bench in `calls.json` whose touch comes from the bar path and that has a reference track
(`tests/bench-commands/data/reference/`, CSRT, not the phone's tracker), the touch must be within 0.2 s of the
reference's lowest point from Start! to Press! (or Rack!). If one isn't, The Playner hears of it before any paid run.

`calls.json` is committed with Walker's yes to item 107; until then this skips, unless REFEREE_SET points at a
built set (`build-set.ts --out`).

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
TOUCH_MS = 200


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


@unittest.skipUnless(os.path.exists(CALLS), 'calls.json waits for Walker\'s yes to item 107 (or set REFEREE_SET)')
class TouchFromThePath(unittest.TestCase):

    def test_every_touch_from_the_path_is_within_0_2_s_of_the_reference(self):
        with open(CALLS) as f:
            attempts = json.load(f)['attempts']
        rows = [r for r in touches(attempts) if r[1] == 'path' and r[3] is not None]
        self.assertTrue(rows, 'no bench took its touch from the path')
        off = [(a['id'], a['cut'], touch - low) for a, _, touch, low in rows if abs(touch - low) > TOUCH_MS]
        self.assertEqual(off, [], 'touch more than 0.2 s from the reference: mail The Playner before any paid run')


if __name__ == '__main__':
    unittest.main()
