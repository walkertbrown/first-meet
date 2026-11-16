"""3.4d step 1: which frames the referee bot gets, and how each is stamped."""
import json
import os
import sys
import unittest
import unittest.mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from PIL import Image  # noqa: E402

import bench_path  # noqa: E402
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
TRACES = os.path.join(os.path.dirname(__file__), '..', '..', 'tests', 'bench-commands', 'data', 'traces')


def wrists(t, y):
    p = [[0.5, 0.5, 0.9] for _ in range(33)]
    p[15] = [0.4, y, 0.9]
    p[16] = [0.6, y, 0.9]
    return {'t': t, 'p': p}


def unseen(t):
    return {'t': t, 'p': None}


def every_frame(a, b):
    """The 15-a-second frame times from a to b, as `pick` sees a 30 fps clip."""
    return [t for t in rf.frame_times(15, 7100) if a <= t <= b]


def rep(t, low=2000, top=3000, y0=0.3, y1=0.6):
    """A bar down from y0 at 1.0 s to y1 at `low`, still to `press` if any, up to y0 - 0.05 at `top`."""
    if t <= 1000:
        return y0
    if t <= low:
        return y0 + (y1 - y0) * (t - 1000) / (low - 1000)
    if t <= top:
        return y1 - (y1 - y0 + 0.05) * (t - low) / (top - low)
    return y0 - 0.05


def path_of(f, a=0, b=7000, step=1000 / 15, score=0.9):
    return [[round(i * step), round(f(round(i * step)), 4), score] for i in range(int(a / step), int(b / step) + 1)]


def grid(a, b):
    return [round(i * 1000 / 15) for i in range(int(a * 15 / 1000), int(b * 15 / 1000) + 1)]


class BenchWay(unittest.TestCase):
    """3.4d step 1, the bar path first: which way the touch is found, and where (worker/bench_path.py)."""

    def way(self, path, wrist_y, start=1000, press=None, rack=4000, duration=7000):
        ran = []

        def ws():
            ran.append(1)
            end = min(duration, press + 3000, rack) if press is not None else rack
            return [wrists(t, y) if (y := wrist_y(t)) is not None else unseen(t) for t in grid(start, end)]
        return bench_path.bench_way(path, ws, start, press, rack, duration), bool(ran)

    def near(self, got, want, ms=70):
        self.assertIsNotNone(got)
        self.assertLessEqual(abs(got - want), ms, (got, want))

    def test_the_path_without_press_lowest_point_to_rack_and_top_after_it_and_no_poses_run(self):
        how, ran = self.way(path_of(rep), lambda t: None)
        self.assertEqual(how['way'], 'path')
        self.near(how['touch'], 2000)
        self.near(how['lockout'], 3000)
        self.assertFalse(ran)

    def test_the_path_with_press_lowest_point_to_press_and_top_to_press_plus_3_s(self):
        # held still at the bottom from 2.0 s to Press! at 2.6 s, up by 3.6 s; lower again after Rack! never counts
        f = lambda t: rep(t, 2000, 3600) if t <= 2000 else (0.6 if t <= 2600 else rep(t - 600, 2000, 3000))  # noqa: E731
        how, _ = self.way(path_of(f), lambda t: None, press=2600, rack=5500)
        self.assertEqual(how['way'], 'path')
        self.assertLessEqual(how['touch'], 2600)
        self.assertGreaterEqual(how['touch'], 1930)
        self.near(how['lockout'], 3600)

    def test_wrists_when_there_is_no_path(self):
        for press, rack in ((None, 4000), (2400, 5000)):
            how, ran = self.way(None, lambda t: rep(t, 2100, 3100), press=press, rack=rack)
            self.assertEqual(how['way'], 'wrists', press)
            self.near(how['touch'], 2100)
            self.near(how['lockout'], 3100)
            self.assertTrue(ran)

    def test_wrists_seen_on_under_half_the_frames_are_not_used(self):
        seen = lambda t: rep(t) if (t // 67) % 3 == 0 else None  # noqa: E731  (a third of the frames)
        for press in (None, 2400):
            how, _ = self.way(None, seen, press=press, rack=5000)
            self.assertEqual(how['way'], 'window', press)
            self.assertIsNone(how['touch'])

    def test_a_path_lost_partway_uses_its_points_before_the_loss_and_the_wrists_after(self):
        # the plate tracker loses the bar at 1.5 s, on the way down; the wrists sit 0.1 higher than the plate
        for press, rack in ((None, 4000), (2600, 5600)):
            lost = [p for p in path_of(rep) if p[0] < 1500]
            how, _ = self.way(lost, lambda t: rep(t) - 0.1, press=press, rack=rack)
            self.assertEqual(how['way'], 'partway', press)
            self.near(how['touch'], 2000)
            self.near(how['lockout'], 3000)
            self.near(how['lost'], 1500)

    def test_a_path_lost_after_press_keeps_its_touch_and_takes_the_lockout_from_the_wrists(self):
        lost = [p for p in path_of(lambda t: rep(t, 2000, 3600)) if p[0] < 2900]
        how, _ = self.way(lost, lambda t: rep(t, 2000, 3600) - 0.1, press=2400, rack=6000)
        self.assertEqual(how['way'], 'path')
        self.near(how['touch'], 2000)
        self.near(how['lockout'], 3600)

    def test_neither_gives_no_touch(self):
        for press in (None, 2400):
            how, _ = self.way(path_of(rep, score=0.2), lambda t: None, press=press, rack=5000)
            self.assertEqual(how['way'], 'window', press)

    def trace(self, id_, w0, w1):
        with open(os.path.join(TRACES, f'{id_}.json')) as f:
            pts = json.load(f)['pts']
        return [[t - w0, y, sc] for t, _, y, sc in pts if w0 <= t <= w1]

    def depth(self, path, t):
        return next(y for u, y, _ in path if u >= t)

    def test_the_80_percent_rule_on_a_real_trace(self):
        """IA0P rep 2 as the test set cuts it (window 9.811 s on, Start! 1.0 s, Press! 3.269 s, Rack! 5.137 s):
        thinned to 90% of its points it takes the path; to 70%, the wrists."""
        path = self.trace('IA0PhDBzsz0', 9811, 9811 + 6500)
        whole, _ = self.way(path, lambda t: 0.5, press=3269, rack=5137, duration=6500)
        self.assertEqual(whole['way'], 'path')
        self.assertEqual(whole['cover'], 1.0)
        ninety, _ = self.way([p for i, p in enumerate(path) if i % 10 < 9], lambda t: 0.5, press=3269, rack=5137, duration=6500)
        self.assertEqual(ninety['way'], 'path')
        self.assertLessEqual(self.depth(path, whole['touch']) - self.depth(path, ninety['touch']), 0.01)
        seventy, _ = self.way([p for i, p in enumerate(path) if i % 10 < 7], lambda t: 0.5, press=3269, rack=5137, duration=6500)
        self.assertEqual(seventy['way'], 'wrists')
        self.assertLess(seventy['cover'], 0.8)

    def test_points_under_0_5_confidence_count_as_missing(self):
        """The same trace with confidence 0.49 from 0.3 s before its touch on: those points are missing, so the path
        is lost there, before Press!, and its points before the loss and the wrists' after it are used. At 0.5
        they still count."""
        path = self.trace('IA0PhDBzsz0', 9811, 9811 + 6500)
        whole, _ = self.way(path, lambda t: 0.5, press=3269, rack=5137, duration=6500)
        for score, want in ((0.49, 'partway'), (0.5, 'path')):
            weak = [[t, y, score if t >= whole['touch'] - 300 else sc] for t, y, sc in path]
            how, _ = self.way(weak, lambda t: 0.5, press=3269, rack=5137, duration=6500)
            self.assertEqual(how['way'], want, score)
            if score < 0.5:
                self.assertLessEqual(abs(how['lost'] - (whole['touch'] - 300)), 70)


NO_PRESS = [(0, 'Bar is loaded.'), (1000, 'Start!'), (4000, 'Rack!')]
PRESS = [(0, 'Bar is loaded.'), (1000, 'Start!'), (2600, 'Press!'), (5600, 'Rack!')]


class BenchFrames(unittest.TestCase):
    """make_frames on the bench, every way in, with and without "Press!": checked by where the frames fall."""

    def run_with(self, find_at, bench, commands):
        import poses
        asked = []

        def fake(video, times):
            asked.extend(times)
            return [find_at(t) for t in times]
        with unittest.mock.patch.object(poses, 'find_at', fake):
            frames, how = rf.make_frames(BENCH_CLIP, commands, [], bench)
        return [t for t, _ in frames], how, asked

    def has(self, times, a, b):
        for t in every_frame(a, b):
            self.assertTrue(any(abs(t - u) <= 34 for u in times), t)   # within half a frame: pick merges closer ones

    def around(self, times, how, touch, lockout):
        """The touch and lockout found within a frame of where the bar was, and every frame 0.4 s either side."""
        self.assertLessEqual(abs(how['touch'] - touch), 70, how)
        self.assertLessEqual(abs(how['lockout'] - lockout), 70, how)
        self.has(times, how['touch'] - 400, how['touch'] + 400)
        self.has(times, how['lockout'] - 400, how['lockout'] + 400)

    def extra(self, times, a, b):
        """Frames between a and b beyond the 2-a-second ones."""
        return [t for t in times if a <= t <= b and t % 500]

    def test_from_the_path_every_frame_0_4_s_either_side_of_the_touch_and_the_lockout(self):
        cases = ((NO_PRESS, {'start_ms': 1000, 'press_ms': None, 'rack_ms': 4000}),
                 (PRESS, {'start_ms': 1000, 'press_ms': 2600, 'rack_ms': 5600}))
        for commands, bench in cases:
            f = (lambda t: rep(t)) if bench['press_ms'] is None else (lambda t: rep(t, 2000, 3600) if t <= 2000 else (0.6 if t <= 2600 else rep(t - 600)))
            times, how, asked = self.run_with(unseen, {**bench, 'path': path_of(f)}, commands)
            self.assertEqual(how['way'], 'path')
            self.assertEqual(asked, [])   # the path gave both moments: no poses run
            lock = 3000 if bench['press_ms'] is None else 3600
            self.around(times, how, 2000, lock)
            if bench['press_ms'] is not None:
                self.has(times, how['touch'], 2900)   # the pause: the touch to 0.3 s after Press!
            self.assertFalse(self.extra(times, 1000, 1550))

    def test_from_the_wrists(self):
        for commands, bench in ((NO_PRESS, {'start_ms': 1000, 'press_ms': None, 'rack_ms': 4000}),
                                (PRESS, {'start_ms': 1000, 'press_ms': 2600, 'rack_ms': 5600})):
            times, how, asked = self.run_with(lambda t: wrists(t, rep(t, 2100, 3100)), bench, commands)
            self.assertEqual(how['way'], 'wrists')
            self.assertEqual(min(asked), 1000)
            self.assertGreaterEqual(max(asked), (4000 if bench['press_ms'] is None else 5600) - 67)
            self.around(times, how, 2100, 3100)
            self.assertFalse(self.extra(times, 1000, 1650))

    def test_partway(self):
        for commands, bench in ((NO_PRESS, {'start_ms': 1000, 'press_ms': None, 'rack_ms': 4000}),
                                (PRESS, {'start_ms': 1000, 'press_ms': 2600, 'rack_ms': 5600})):
            path = [p for p in path_of(rep) if p[0] < 1500]
            times, how, _ = self.run_with(lambda t: wrists(t, rep(t) - 0.1), {**bench, 'path': path}, commands)
            self.assertEqual(how['way'], 'partway')
            self.around(times, how, 2000, 3000)

    def test_neither_without_press_takes_1_5_s_from_0_5_s_after_start_and_the_rack(self):
        times, how, _ = self.run_with(unseen, {'start_ms': 1000, 'press_ms': None, 'rack_ms': 4000}, NO_PRESS)
        self.assertEqual(how['way'], 'window')
        self.has(times, 1500, 3000)
        self.has(times, 3400, 4000)

    def test_neither_with_press_takes_1_s_before_to_0_5_s_after_it_and_the_rack(self):
        times, how, asked = self.run_with(unseen, {'start_ms': 1000, 'press_ms': 2600, 'rack_ms': 5600}, PRESS)
        self.assertEqual(how['way'], 'window')
        self.assertLessEqual(max(asked), 5600)
        self.has(times, 1600, 3100)
        self.has(times, 5000, 5600)
        self.assertFalse(self.extra(times, 3200, 4950))

    def test_the_demo_benchs_rep_2_with_its_press_taken_out_gets_at_least_20_frames(self):
        """Real poses on a real bench: rep 2 of the bench demo (window 0.6–5.07 s), sent as a phone with no Press!
        would. The demo's clip cuts between camera angles, so it has no bar path: the wrists find the touch."""
        commands = [(0, 'Bar is loaded.'), (270, 'Start!'), (3430, 'Rack!')]
        frames, how = rf.make_frames(BENCH_CLIP, commands, [], {'start_ms': 270, 'press_ms': None, 'rack_ms': 3430},
                                     window=(600, 5070))
        self.assertEqual(how['way'], 'wrists')
        self.assertGreaterEqual(len(frames), 20)


if __name__ == '__main__':
    unittest.main()
