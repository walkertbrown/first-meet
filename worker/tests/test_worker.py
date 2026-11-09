"""The worker's pieces that don't need MediaPipe (run in CI: python -m unittest discover worker/tests)."""
import hashlib
import hmac
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import poses  # noqa: E402


class VendorGl(unittest.TestCase):
    def test_reads_a_deb(self):
        import io
        import tarfile
        import vendor_gl
        tar = io.BytesIO()
        with tarfile.open(fileobj=tar, mode='w:xz') as t:
            for name, data in [('./usr/lib/x86_64-linux-gnu/libX.so.1.0.0', b'lib')]:
                info = tarfile.TarInfo(name)
                info.size = len(data)
                t.addfile(info, io.BytesIO(data))
            link = tarfile.TarInfo('./usr/lib/x86_64-linux-gnu/libX.so.1')
            link.type, link.linkname = tarfile.SYMTYPE, 'libX.so.1.0.0'
            t.addfile(link)

        def member(name: str, data: bytes) -> bytes:
            head = f'{name + "/":<16}{0:<12}{0:<6}{0:<6}{100644:<8}{len(data):<10}`\n'.encode()
            return head + data + (b'\n' if len(data) & 1 else b'')

        deb = b'!<arch>\n' + member('debian-binary', b'2.0\n') + member('data.tar.xz', tar.getvalue())
        self.assertEqual(vendor_gl.extract(deb, {'libX.so.1'}), {'libX.so.1': b'lib'})

    def test_pins_every_package(self):
        import vendor_gl
        self.assertTrue(all(len(h) == 64 for h in vendor_gl.DEBS.values()))


class TimingClip(unittest.TestCase):
    def test_made_like_a_phone_clip(self):
        import tempfile
        import av
        import timing_clip
        with tempfile.TemporaryDirectory() as d:
            out = timing_clip.make('t', Path(d) / 't.mp4', {'t': ('half-squat', 2, 1.0)})
            with av.open(str(out)) as c:
                s = c.streams.video[0]
                frames = sum(1 for _ in c.decode(s))
                self.assertEqual((s.codec_context.name, s.width, s.height, frames), ('h264', 960, 720, 30))

    def test_names(self):
        import timing_clip
        self.assertEqual(set(timing_clip.CLIPS), {'timing-barbell-30s', 'timing-home-90s'})


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

    def test_zoom_times_are_every_frame_in_the_windows(self):
        import main
        got = main.zoom_times(3.0, [[0, 700], [600, 800], [2900, 3100]])
        self.assertEqual(got, [0, 67, 133, 200, 267, 333, 400, 467, 533, 600, 667, 733, 800, 2933])

    def test_no_retries(self):
        import main
        self.assertEqual(main.NO_RETRY.max_retries, 0)


CAMERA = Path(__file__).resolve().parents[2] / 'tests' / 'camera' / 'camera-recording.webm'


class CameraWebm(unittest.TestCase):
    """A browser MediaRecorder WebM (NerdCider's ab059242 on staging) has no length in its
    header. The judge read that as 0 s, looked at no frames, and the attempt waited out two
    leases into a judge_unavailable close call."""

    def test_the_header_has_no_length(self):
        import av
        with av.open(str(CAMERA)) as c:
            self.assertFalse(c.streams.video[0].duration)
            self.assertFalse(c.duration)

    def test_its_length_is_read_from_the_packets(self):
        info = poses.clip_info(str(CAMERA))
        self.assertTrue(10.09 < info.duration < 10.4, info.duration)  # last frame at 10.099 s, plus one frame
        self.assertGreater(len(poses.grid(info.duration, 5)), 45)


class OneBadClip(unittest.TestCase):
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

    def test_an_exception_reports_that_attempt_and_returns(self):
        def boom(job):
            raise RuntimeError('cannot decode')
        out = self.main.attempt_or_report({'attempt_id': 'a1', 'worker_id': 'w1'}, run=boom)
        self.assertIn('cannot decode', out['error'])
        self.assertEqual(self.sent, [('/api/internal/failed', {'attempt_id': 'a1', 'worker_id': 'w1', 'why': out['error']})])

    def test_a_refused_post_reports_too(self):
        self.main.attempt_or_report({'attempt_id': 'a2', 'worker_id': 'w1'}, run=lambda job: {'attempt_id': 'a2', 'error': 'pass 1 post: 400'})
        self.assertEqual(self.sent[0][0], '/api/internal/failed')

    def test_a_good_attempt_reports_nothing(self):
        self.main.attempt_or_report({'attempt_id': 'a3', 'worker_id': 'w1'}, run=lambda job: {'attempt_id': 'a3', 'frames': 9})
        self.assertEqual(self.sent, [])

    def test_a_network_error_is_a_failed_post(self):
        import os
        os.environ.setdefault('JUDGE_CALLBACK_SECRET', 'x')
        old = self.main.APP_URL
        self.main.APP_URL = 'http://127.0.0.1:9'
        try:
            self.assertEqual(self._post('/api/internal/next', {}, timeout=2), (0, None))
        finally:
            self.main.APP_URL = old


if __name__ == '__main__':
    unittest.main()
