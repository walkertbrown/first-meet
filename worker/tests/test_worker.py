"""The worker's pieces that don't need MediaPipe (run in CI: python -m unittest discover worker/tests)."""
import hashlib
import hmac
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import poses  # noqa: E402


class Grid(unittest.TestCase):
    def test_five_a_second(self):
        self.assertEqual(poses.grid(1.0, 5), [0, 200, 400, 600, 800])

    def test_matches_chromium_frame_times(self):
        # tests/judge/pose-page.ts steps t += 1/fps and stops 20 ms short of the end
        import json
        clips = Path(__file__).resolve().parents[2] / 'tests/clips/poses'
        for f in clips.glob('*.json'):
            raw = json.loads(f.read_text())
            self.assertEqual([x['t'] for x in raw['frames']], poses.grid(raw['duration'], 15), f.name)

    def test_first_pass_frames_are_on_the_second_pass_grid(self):
        self.assertTrue(set(poses.grid(30, 5)) <= set(poses.grid(30, 15)))

    def test_window(self):
        self.assertEqual(poses.grid(3.0, 15, 600, 800), [600, 667, 733, 800])

    def test_middle(self):
        self.assertEqual(poses.middle([0, 200, 400, 600]), 400)
        self.assertIsNone(poses.middle([0]))


class Signing(unittest.TestCase):
    def setUp(self):
        try:
            import main  # noqa: F401
        except ImportError as e:  # the Render SDK isn't installed
            self.skipTest(str(e))

    def test_hmac_over_time_and_body(self):
        import main
        h = main.sign(b'{"a":1}', 'secret', 1700000000)
        want = hmac.new(b'secret', b'1700000000.{"a":1}', hashlib.sha256).hexdigest()
        self.assertEqual(h, {'x-fm-time': '1700000000', 'x-fm-signature': want})

    def test_zoom_times_skip_first_pass_frames(self):
        import main
        got = main.zoom_times(3.0, [[0, 700]], set(poses.grid(3.0, 5)))
        self.assertEqual(got, [67, 133, 267, 333, 467, 533, 667])

    def test_no_retries(self):
        import main
        self.assertEqual(main.NO_RETRY.max_retries, 0)


if __name__ == '__main__':
    unittest.main()
