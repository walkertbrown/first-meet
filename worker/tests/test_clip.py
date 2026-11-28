"""Her lift clip (piece 7, worker/clip.py): the timing, the thocks, look 9's layout, and one real render
with the bundled ffmpeg: 9:16 H.264 and AAC, 15 s or less."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    import numpy as np
    import clip
    from PIL import Image
except ImportError as e:  # Pillow or imageio-ffmpeg isn't installed
    clip = None
    MISSING = str(e)


def needs_clip(cls):
    return unittest.skipIf(clip is None, 'clip needs Pillow and numpy')(cls)


@needs_clip
class Timing(unittest.TestCase):
    def test_times_match_the_stage(self):
        t = clip.Times()
        self.assertEqual((t.lamps_ms, t.lamp_gap_ms, t.hold_ms, t.fade_ms, t.card_ms), (1410, 330, 2000, 400, 3000))
        self.assertEqual(clip.Times.of({'hold_ms': 1500}).hold_ms, 1500)

    def test_frames_at_30_a_second(self):
        self.assertEqual(clip.frames_for(2000), 60)
        self.assertEqual(clip.frames_for(400), 12)
        self.assertEqual(clip.frames_for(1410), 42)


@needs_clip
class Thocks(unittest.TestCase):
    def test_white_is_higher_than_red_and_gone_by_220_ms(self):
        w, r = clip.thock(False), clip.thock(True)
        self.assertLessEqual(float(np.abs(w).max()), 0.35 + 1e-6)
        self.assertGreater(float(np.abs(w[: int(clip.RATE * 0.05)]).max()), 0.2)
        self.assertEqual(float(np.abs(w[int(clip.RATE * 0.221):]).max()), 0.0)
        crossings = lambda s: int(np.sum(np.diff(np.sign(s[: int(clip.RATE * 0.1)])) != 0))  # noqa: E731
        self.assertGreater(crossings(w), crossings(r))

    def test_one_thock_as_each_lamp_lights(self):
        s = clip.soundtrack(6000, 2000, ['white', 'white', 'red'], 330)
        loud = lambda ms: float(np.abs(s[int(clip.RATE * ms / 1000): int(clip.RATE * (ms + 30) / 1000)]).max())  # noqa: E731
        self.assertEqual(loud(0), 0.0)
        for ms in (2000, 2330, 2660):
            self.assertGreater(loud(ms), 0.1)
        self.assertEqual(float(np.abs(s[int(clip.RATE * 3.0):]).max()), 0.0)


@needs_clip
class Layout(unittest.TestCase):
    def test_landscape_is_look_9(self):
        lay = clip.layout(1280, 720)
        self.assertTrue(lay.landscape)
        self.assertEqual(lay.box, (0, 560, 1080, 608))
        self.assertEqual((lay.lamp_r * 2, lay.lamp_gap, lay.lamp_cy - lay.lamp_r), (120, 36, 220))
        x, y, w, h = clip.fit(1280, 720, lay.box)
        self.assertEqual((x, w), (0, 1080))   # full width, never cropped
        self.assertTrue(560 <= y and y + h <= 1168)

    def test_the_lift_line_sits_on_one_baseline(self):
        # LookieBot at e0e2353: each letter at its own top raised the middle dot to cap height
        from PIL import ImageDraw
        hud = clip._font('anybody-800-112.ttf', 40)

        def ink_rows(text):
            im = Image.new('L', (900, 120), 0)
            clip.tracked(ImageDraw.Draw(im), (450, 20), text, hud, 255, 0.04 * 40)
            rows = np.nonzero(np.asarray(im).max(axis=1))[0]
            return int(rows.min()), int(rows.max())

        cap_top, base = ink_rows('DEADLIFT')
        self.assertEqual(cap_top, 20)                            # the capitals' top stays where look 9 puts it
        dot_top, dot_bottom = ink_rows('·')
        mid = (dot_top + dot_bottom) / 2
        self.assertGreater(mid, cap_top + (base - cap_top) * 0.3)  # at the letters' middle, not their top
        self.assertLess(mid, cap_top + (base - cap_top) * 0.7)

    def test_portrait_fills_the_frame_uncropped(self):
        lay = clip.layout(720, 1280)
        self.assertFalse(lay.landscape)
        self.assertEqual(clip.fit(720, 1280, lay.box), (0, 0, 1080, 1920))
        x, y, w, h = clip.fit(480, 640, lay.box)   # a 3:4 camera: the whole picture, centred
        self.assertEqual((x, w), (0, 1080))
        self.assertLessEqual(h, 1920)


def ffmpeg_ok():
    try:
        import imageio_ffmpeg
        imageio_ffmpeg.get_ffmpeg_exe()
        return True
    except Exception:  # noqa: BLE001
        return False


@needs_clip
@unittest.skipUnless(clip is not None and ffmpeg_ok(), 'no bundled ffmpeg')
class Render(unittest.TestCase):
    """A 3 s landscape attempt made with ffmpeg's test source, rendered end to end."""

    def test_a_9_16_h264_aac_clip_of_15_s_or_less(self):
        with tempfile.TemporaryDirectory() as d:
            src = str(Path(d) / 'attempt.webm')
            subprocess.run([clip.ffmpeg_exe(), '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3',
                            '-c:v', 'libvpx', '-b:v', '500k', src], check=True, timeout=60)
            card = Image.new('RGB', (1080, 1920), (40, 40, 60))
            job = {'start_ms': 500, 'end_ms': 2900, 'judged_ms': 2000, 'lamps': ['white', 'red', 'white'], 'mirror': True,
                   'marks': {'pts': [[0.4, 0.5], [0.6, 0.55], [0.6, 0.8]], 'colour': '#FFF4D8'},
                   'lift_line': 'BENCH · 2 OF 3', 'weight': '85 lb'}
            out = str(Path(d) / 'clip.mp4')
            got = clip.render(job, src, card, out, d)
            self.assertTrue(got['landscape'])
            self.assertEqual(got['footage_frames'], 72)
            self.assertEqual(got['frames'], 72 + 42 + 60 + 12 + 90)
            info = subprocess.run([clip.ffmpeg_exe(), '-hide_banner', '-i', out], capture_output=True, text=True).stderr
            self.assertIn('Video: h264', info)
            self.assertIn('1080x1920', info)
            self.assertIn('Audio: aac', info)
            w, h, secs = clip.probe(out)
            self.assertEqual((w, h), (1080, 1920))
            self.assertLessEqual(secs, 15.0)
            self.assertAlmostEqual(secs, got['frames'] / 30, delta=0.15)
            # the last frame is her card
            last = subprocess.run([clip.ffmpeg_exe(), '-v', 'error', '-sseof', '-0.2', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                                  capture_output=True, check=True).stdout
            px = np.frombuffer(last, dtype=np.uint8).reshape(1920, 1080, 3)[960, 540]
            self.assertTrue(all(abs(int(a) - b) < 8 for a, b in zip(px, (40, 40, 60))), px)

    def test_the_poster_is_the_first_frame_of_the_hold_at_432_by_768(self):
        # look 9 "The bomb-out clip": the judged frame with the marks under the lit lamps, a JPEG beside the clip
        with tempfile.TemporaryDirectory() as d:
            src = str(Path(d) / 'attempt.webm')
            subprocess.run([clip.ffmpeg_exe(), '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x204060:size=360x640:rate=30:duration=2',
                            '-c:v', 'libvpx', '-b:v', '500k', src], check=True, timeout=60)
            card = Image.new('RGB', (1080, 1920), (40, 40, 60))
            job = {'start_ms': 0, 'end_ms': 1900, 'judged_ms': 1500, 'lamps': ['white'] * 3, 'mirror': False, 'marks': None,
                   'lift_line': 'DEADLIFT · 2 OF 3', 'weight': '155 lb'}
            poster = str(Path(d) / 'poster.jpg')
            clip.render(job, src, card, str(Path(d) / 'clip.mp4'), d, poster)
            im = Image.open(poster)
            self.assertEqual(im.format, 'JPEG')
            self.assertEqual(im.size, (432, 768))
            # the footage, dimmed for the hold, not the card
            r, g, b = im.convert('RGB').getpixel((216, 500))
            self.assertGreater(b, r + 20, (r, g, b))
            self.assertNotEqual((round(r / 8), round(g / 8), round(b / 8)), (5, 5, 8))


class RenderClipTask(unittest.TestCase):
    def setUp(self):
        try:
            import main
        except ImportError as e:  # the Render SDK isn't installed
            self.skipTest(str(e))
        self.main = main
        self.sent = []
        self._post = main.post
        main.post = lambda path, payload, timeout=30: (self.sent.append((path, payload)), (200, None))[1]

    def tearDown(self):
        self.main.post = self._post

    def test_a_made_clip_says_so(self):
        self.main.clip_or_report({'attempt_id': 'a1', 'worker_id': 'c-1'}, run=lambda job: {'secs': 9.5, 'bytes': 1000})
        self.assertEqual(self.sent[0][0], '/api/internal/clip')
        self.assertEqual(self.sent[0][1]['ok'], True)
        self.assertEqual(self.sent[0][1]['bytes'], 1000)

    def test_a_failure_says_why_and_the_run_goes_on(self):
        def boom(job):
            raise RuntimeError('no footage between start and end')
        out = self.main.clip_or_report({'attempt_id': 'a2', 'worker_id': 'c-1'}, run=boom)
        self.assertIn('no footage', out['error'])
        self.assertEqual(self.sent[0][1]['ok'], False)
        self.assertIn('no footage', self.sent[0][1]['error'])

    def test_staging_fault_fails_the_clip_through_the_real_path(self):
        out = self.main.clip_or_report({'attempt_id': 'a3', 'worker_id': 'c-1', 'fault': True})
        self.assertIn('FAULT=clip', out['error'])
        self.assertEqual(self.sent[0][1]['ok'], False)

    def test_the_task_is_registered(self):
        self.assertIsInstance(self.main.render_clip, type(self.main.find_poses))


if __name__ == '__main__':
    unittest.main()
