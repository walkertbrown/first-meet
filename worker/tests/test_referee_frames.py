"""3.4d step 1: which frames the referee bot gets, and how each is stamped."""
import os
import sys
import unittest
import unittest.mock

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



BENCH_CLIP = os.path.join(os.path.dirname(__file__), '..', '..', 'tests', 'clips', 'bench-demo.webm')
NO_PRESS = [(0, 'Bar is loaded.'), (1000, 'Start!'), (4000, 'Rack!')]


def wrists(t, y):
    p = [[0.5, 0.5, 0.9] for _ in range(33)]
    p[15] = [0.4, y, 0.9]
    p[16] = [0.6, y, 0.9]
    return {'t': t, 'p': p}


def every_frame(a, b):
    """The 15-a-second frame times from a to b, as `pick` sees a 30 fps clip."""
    return [t for t in rf.frame_times(15, 7100) if a <= t <= b]


class NoPressBench(unittest.TestCase):
    """3.4d step 1: a bench with no "Press!" (the bar never stopped) still gets every frame around its touch
    and lockout. Checked by where the frames fall, not only how many there are."""

    def test_the_touch_is_the_lowest_point_to_rack_and_the_lockout_the_top_after_it(self):
        ys = {1000: 0.3, 1500: 0.45, 2000: 0.6, 2500: 0.45, 3000: 0.25, 3500: 0.3, 4000: 0.3, 4500: 0.9, 4600: 0.1}
        pts = [wrists(t, y) for t, y in ys.items()]
        # nothing after Rack! counts, low or high
        self.assertEqual(rf.bench_moments(pts, 1000, None, 4000), (2000, 3000))

    def run_with(self, find_at, bench):
        import poses
        asked = []

        def fake(video, times):
            asked.extend(times)
            return [find_at(t) for t in times]
        with unittest.mock.patch.object(poses, 'find_at', fake):
            frames, found = rf.make_frames(BENCH_CLIP, NO_PRESS, [], bench)
        return [t for t, _ in frames], found, asked

    def test_poses_give_every_frame_0_4_s_either_side_of_the_touch_and_the_lockout(self):
        def y(t):   # down to the chest at 2.0 s, no stop, locked out at 3.0 s
            return 0.3 + 0.3 * t / 1000 - 0.3 if t <= 2000 else max(0.25, 0.6 - 0.35 * (t - 2000) / 1000)
        times, found, asked = self.run_with(lambda t: wrists(t, 0.3 if t < 1000 else y(t)),
                                            {'start_ms': 1000, 'press_ms': None, 'rack_ms': 4000})
        self.assertTrue(found)
        # the poses are looked for from Start! all the way to Rack!, not to a Press! that never came
        self.assertEqual(min(asked), 1000)
        self.assertGreaterEqual(max(asked), 4000 - 67)
        for t in every_frame(1600, 2400) + every_frame(2600, 3400):
            self.assertTrue(any(abs(t - u) <= 34 for u in times), t)   # within half a frame: pick merges closer ones
        self.assertGreaterEqual(len(times), 20)

    def test_no_usable_poses_uses_the_bar_paths_lowest_point_and_the_rack(self):
        times, found, _ = self.run_with(lambda t: {'t': t, 'p': None},
                                        {'start_ms': 1000, 'press_ms': None, 'rack_ms': 4000, 'bar_low_ms': 2200})
        self.assertFalse(found)
        for t in every_frame(1800, 2600) + every_frame(3400, 4000):
            self.assertTrue(any(abs(t - u) <= 34 for u in times), t)   # within half a frame: pick merges closer ones
        self.assertFalse([t for t in every_frame(1000, 1700) if t in times and t % 500])   # nothing extra before the touch

    def test_no_poses_and_no_bar_path_takes_1_5_s_from_0_5_s_after_start_and_the_rack(self):
        times, found, _ = self.run_with(lambda t: {'t': t, 'p': None},
                                        {'start_ms': 1000, 'press_ms': None, 'rack_ms': 4000, 'bar_low_ms': None})
        self.assertFalse(found)
        for t in every_frame(1500, 3000) + every_frame(3400, 4000):
            self.assertTrue(any(abs(t - u) <= 34 for u in times), t)   # within half a frame: pick merges closer ones

    def test_a_bench_with_a_press_is_as_before(self):
        times, found, asked = self.run_with(lambda t: {'t': t, 'p': None}, {'start_ms': 1000, 'press_ms': 2500, 'rack_ms': 4000})
        self.assertFalse(found)
        self.assertLessEqual(max(asked), 2500 + 3000)
        for t in every_frame(1500, 3000) + every_frame(3400, 4000):
            self.assertTrue(any(abs(t - u) <= 34 for u in times), t)   # within half a frame: pick merges closer ones

    def test_the_demo_benchs_rep_2_with_its_press_taken_out_gets_at_least_20_frames(self):
        """Real poses on a real bench: rep 2 of the bench demo (window 0.6–5.07 s), sent as a phone with no Press! would."""
        commands = [(0, 'Bar is loaded.'), (270, 'Start!'), (3430, 'Rack!')]
        frames, found = rf.make_frames(BENCH_CLIP, commands, [], {'start_ms': 270, 'press_ms': None, 'rack_ms': 3430},
                                       window=(600, 5070))
        self.assertTrue(found)
        self.assertGreaterEqual(len(frames), 20)


if __name__ == '__main__':
    unittest.main()
