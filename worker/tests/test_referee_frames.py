"""3.4d step 1: which frames the referee bot gets, and how each is stamped."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from PIL import Image  # noqa: E402

import referee_frames as rf  # noqa: E402

SQUAT = [(0, 'Bar is loaded.'), (1500, 'Squat!'), (6000, 'Rack!')]


class Pick(unittest.TestCase):
    def test_two_a_second_from_the_first_command_to_rack_and_every_frame_around_each_moment(self):
        times = rf.pick(15, 8000, SQUAT, [{'ms': 3000, 'flagged': True}])
        for t in range(0, 6001, 500):
            self.assertIn(t, times)
        around = [t for t in times if 2600 <= t <= 3400]
        self.assertGreaterEqual(len(around), 12)   # every frame at 15 a second, 0.4 s each side
        self.assertTrue(all(t <= 6000 for t in times if t not in around))
        self.assertLessEqual(len(times), 60)

    def test_over_60_the_two_a_second_frames_thin_first_then_clean_reps_and_the_flagged_rep_stays(self):
        cmds = [(0, 'Weights ready.'), (500, 'Start!'), (40_000, 'Rack!')]   # a long Home set
        moments = [{'ms': 2000 + i * 3000, 'flagged': i == 5} for i in range(12)]
        times = rf.pick(15, 41_000, cmds, moments)
        self.assertEqual(len(times), 60)
        flagged = [t for t in rf.frame_times(15, 41_000) if 17_000 - 400 <= t <= 17_000 + 400]
        for t in flagged:
            self.assertIn(t, times)

    def test_the_bench_pause_is_every_frame_from_the_lowest_point_to_0_3_s_after_press(self):
        cmds = [(0, 'Bar is loaded.'), (1000, 'Start!'), (3000, 'Press!'), (5000, 'Rack!')]
        times = rf.pick(15, 6000, cmds, [], pause=(2400, 3000))
        span = [t for t in rf.frame_times(15, 6000) if 2400 <= t <= 3300]
        for t in span:
            self.assertIn(t, times)

    def test_no_usable_poses_takes_every_frame_around_press_and_before_rack(self):
        cmds = [(0, 'Bar is loaded.'), (1000, 'Start!'), (3000, 'Press!'), (5000, 'Rack!')]
        times = rf.pick(15, 6000, cmds, [], fallback=[(2000, 3500), (4400, 5000)])
        for t in rf.frame_times(15, 6000):
            if 2000 <= t <= 3500 or 4400 <= t <= 5000:
                self.assertIn(t, times)


class Stamp(unittest.TestCase):
    def test_the_time_with_two_decimals_and_the_last_command(self):
        self.assertEqual(rf.label(2400, SQUAT), ['2.40 s', 'after Squat!'])
        self.assertEqual(rf.label(6500, SQUAT), ['6.50 s', 'after Rack!'])
        self.assertEqual(rf.label(10, [(500, 'Start!')]), ['0.01 s'])

    def test_512_wide_jpeg_with_the_ink_at_the_top_left(self):
        img = rf.burn(Image.new('RGB', (1080, 1920), (90, 90, 90)), ['2.40 s', 'after Press!'])
        self.assertEqual(img.size, (512, 910))
        px = [img.getpixel((x, y)) for x in range(12, 80) for y in range(12, 36)]
        self.assertIn(rf.INK, px)
        self.assertIn(rf.OUTLINE, px)
        self.assertEqual(img.getpixel((400, 600)), (90, 90, 90))
        self.assertEqual(rf.jpeg(img)[:3], b'\xff\xd8\xff')


class BenchMoments(unittest.TestCase):
    def test_the_wrists_lowest_point_before_press_and_their_top_after(self):
        def f(t, y):
            p = [[0.5, 0.5, 0.9] for _ in range(33)]
            p[15] = [0.4, y, 0.9]
            p[16] = [0.6, y, 0.9]
            return {'t': t, 'p': p}
        ys = {1000: 0.3, 1500: 0.45, 2000: 0.6, 2500: 0.61, 3000: 0.6, 3500: 0.4, 4000: 0.25, 4500: 0.3}
        self.assertEqual(rf.bench_moments([f(t, y) for t, y in ys.items()], 1000, 3000), (2500, 4000))
        self.assertIsNone(rf.bench_moments([{'t': 1000, 'p': None}], 1000, 3000))


CLIP = os.path.join(os.path.dirname(__file__), '..', '..', 'tests', 'clips', 'deadlift-demo.webm')


class MakeFrames(unittest.TestCase):
    """The one path the worker's job and tests/referee-bot/recut.py share."""

    def test_a_clip_on_disk_gives_stamped_jpegs_at_the_picked_times_the_same_every_run(self):
        commands = [(0, 'Bar is loaded.'), (2000, 'Down!')]
        moments = [{'ms': 1200, 'flagged': True}]
        frames, bench = rf.make_frames(CLIP, commands, moments, None)
        self.assertIsNone(bench)
        times = [t for t, _ in frames]
        self.assertEqual(times, sorted(times))
        self.assertEqual(times[0], 0)
        self.assertIn(2000, times)  # 2 a second up to "Down!"
        self.assertTrue(all(800 <= t <= 1600 for t in times if t not in (0, 500, 1000, 1500, 2000)))
        self.assertTrue(all(j[:3] == b'\xff\xd8\xff' for _, j in frames))
        self.assertEqual(Image.open(__import__('io').BytesIO(frames[0][1])).size[0], rf.WIDTH)
        again, _ = rf.make_frames(CLIP, commands, moments, None)
        self.assertEqual(frames, again)

    def test_a_window_is_the_attempt_with_every_time_from_its_start(self):
        commands = [(0, 'Bar is loaded.'), (1000, 'Down!')]
        cut, _ = rf.make_frames(CLIP, commands, [], None, window=(2000, 4000))
        self.assertEqual([t for t, _ in cut], [0, 500, 1000])
        # the window's first frame is the clip's frame at 2.0 s, stamped 0.00 s
        want = rf.jpeg(rf.burn(rf.grab(CLIP, [2000])[0], rf.label(0, commands)))
        self.assertEqual(cut[0][1], want)

    def test_the_cap_holds(self):
        frames, _ = rf.make_frames(CLIP, [(0, 'Bar is loaded.')], [], None, cap=5)
        self.assertEqual(len(frames), 5)


if __name__ == '__main__':
    unittest.main()
