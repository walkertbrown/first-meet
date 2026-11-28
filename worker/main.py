"""The Render Workflow that finds poses (plan 2.3, 3.9).

`find_poses(worker_id)` is a worker: it asks the web service for the next waiting
attempt, finds its poses in two passes, posts the points back, and asks again. It never
judges: the one judge (web/lib/judge/) runs in the web service, which also tells it
where the second pass looks.

A Barbell bench (plan 3.4b) comes with `track: 'bar'` and her `plate_tap`: in place of the
pose run, the worker follows the plate from the tap on its 15-a-second frames
(worker/plate.py, the phone's tracker in Python) and posts the path to /api/internal/bar.

`render_clip(worker_id)` makes lift clips (piece 7, worker/clip.py): it asks for the next clip,
draws it from her attempt and her story card, PUTs the MP4 to R2 at the link it was given, says how
it went, and asks again. The web service only hands one out while no attempt waits for its poses.

`find_clip(clip, times_ms, split_ms, fps)` finds poses in one of the repo's test clips at
the times given, or in a timing clip made from one (worker/timing_clip.py). It proves the
pose finder on Render (piece 6) and measures it; its points come back gzipped in the
result, well under Render's 4 MB cap.

Build: pip install -r worker/requirements.txt && python worker/vendor_gl.py
Start: python worker/main.py
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import hmac
import io
import json
import os
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

STARTED = time.monotonic()
sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image  # noqa: E402
from render import Retry, TaskContext, Workflows  # noqa: E402

import clip  # noqa: E402
import plate  # noqa: E402
import poses  # noqa: E402
import referee_frames as rf  # noqa: E402
import timing_clip  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
COMMIT = (os.environ.get('RENDER_GIT_COMMIT') or 'unknown')[:7]
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
WORKER_IDLE_S = float(os.environ.get('WORKER_IDLE_S', 20))
WORKER_MAX_S = float(os.environ.get('WORKER_MAX_S', 15 * 60))
ZOOM_FPS = poses.ZOOM_FPS
FIRST_FPS = poses.FIRST_FPS
zoom_times = poses.zoom_times

# Render retries a task 3 times by default; the web service owns retrying, through the lease (3.9).
NO_RETRY = Retry(max_retries=0, wait_duration_ms=1000)

app = Workflows(default_retry=NO_RETRY, default_plan='2c-4g')


def sign(body: bytes, secret: str, now: int | None = None) -> dict[str, str]:
    """The HMAC headers /api/internal/* check: sha256 over "<unix seconds>.<body>"."""
    ts = str(now if now is not None else int(time.time()))
    mac = hmac.new(secret.encode(), ts.encode() + b'.' + body, hashlib.sha256).hexdigest()
    return {'x-fm-time': ts, 'x-fm-signature': mac}


def post(path: str, payload: dict, timeout: float = 30) -> tuple[int, dict | None]:
    body = json.dumps(payload, separators=(',', ':')).encode()
    headers = {'content-type': 'application/json', **sign(body, os.environ['JUDGE_CALLBACK_SECRET'])}
    req = urllib.request.Request(APP_URL + path, data=body, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:  # noqa: BLE001 - a network error is a failed post, never the end of the worker
        return 0, None


def one_attempt(job: dict) -> dict:
    """Two passes on one attempt (plan 2.3). The web service judges after pass 2."""
    t0 = time.monotonic()
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, 'clip')
        urllib.request.urlretrieve(job['video_url'], path)
        got = time.monotonic()
        info = poses.clip_info(path)
        f1 = poses.first_pass(path, info.duration)
        status, zoom = post('/api/internal/poses', {
            'attempt_id': job['attempt_id'], 'worker_id': job.get('worker_id'), 'pass': 1,
            'w': info.w, 'h': info.h, 'duration': info.duration, 'frames': f1,
        })
        if status != 200 or not zoom:
            return {'attempt_id': job['attempt_id'], 'error': f'pass 1 post: {status}'}
        f2 = poses.second_pass(path, info.duration, zoom.get('windows', []), zoom.get('split_ms'))  # its zoomWindows()
        secs = time.monotonic() - t0
        status, _ = post('/api/internal/poses', {
            'attempt_id': job['attempt_id'], 'worker_id': job.get('worker_id'), 'pass': 2,
            'w': info.w, 'h': info.h, 'duration': info.duration, 'frames': f2,
            'commit': COMMIT, 'secs': round(secs, 2), 'download_secs': round(got - t0, 2),
        })
        if status != 200:
            return {'attempt_id': job['attempt_id'], 'error': f'pass 2 post: {status}'}
    return {'attempt_id': job['attempt_id'], 'frames': len(f1) + len(f2), 'secs': round(secs, 2), 'posted': status}


def one_bar(job: dict) -> dict:
    """A Barbell bench (plan 3.4b): the plate's path from her tap, for the referee's marks."""
    t0 = time.monotonic()
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, 'clip')
        urllib.request.urlretrieve(job['video_url'], path)
        got = time.monotonic()
        info = poses.clip_info(path)
        # from the tap's frame (item 110: `t`, the last tap's ms in the recording; an old phone's has none, so 0)
        tap = job['plate_tap']
        start = tap.get('t') if isinstance(tap.get('t'), (int, float)) else 0
        bar = plate.track_clip(path, tap, info.duration, int(max(0, start)))
        secs = time.monotonic() - t0
        status, _ = post('/api/internal/bar', {
            'attempt_id': job['attempt_id'], 'worker_id': job.get('worker_id'),
            'w': info.w, 'h': info.h, 'duration': info.duration, 'path': bar,
            'commit': COMMIT, 'secs': round(secs, 2), 'download_secs': round(got - t0, 2),
        })
        if status != 200:
            return {'attempt_id': job['attempt_id'], 'error': f'bar post: {status}'}
    return {'attempt_id': job['attempt_id'], 'frames': len(bar), 'secs': round(secs, 2), 'posted': status}


def run_for(job: dict):
    """The bench's bar path, or the two pose passes."""
    return one_bar if job.get('track') == 'bar' else one_attempt


def attempt_or_report(job: dict, run=None) -> dict:
    """One attempt; if anything about it fails, that attempt alone becomes a close call
    (`judge_unavailable`, plan 3.11) and the worker goes on to the next one."""
    try:
        out = (run or run_for(job))(job)
    except Exception as e:  # noqa: BLE001 - one bad clip never stops the worker
        out = {'attempt_id': job['attempt_id'], 'error': f'{type(e).__name__}: {e}'[:300]}
    if out.get('error'):
        post('/api/internal/failed', {'attempt_id': job['attempt_id'], 'worker_id': job.get('worker_id'), 'why': out['error']})
    return out


@app.task(timeout_seconds=int(WORKER_MAX_S) + 300)
def find_poses(ctx: TaskContext, worker_id: str) -> dict:
    begun = time.monotonic()
    poses.pool()  # load the model in both processes before the first attempt
    ready = time.monotonic()
    done: list[dict] = []
    idle_since = time.monotonic()
    try:
        while time.monotonic() - begun < WORKER_MAX_S:
            status, job = post('/api/internal/next', {'worker_id': worker_id})
            if status == 200 and job and job.get('attempt_id'):
                job['worker_id'] = worker_id
                done.append(attempt_or_report(job))
                idle_since = time.monotonic()
                continue
            if time.monotonic() - idle_since >= WORKER_IDLE_S:
                break
            time.sleep(1)
    finally:
        post('/api/internal/worker-done', {'worker_id': worker_id, 'commit': COMMIT, 'attempts': len(done)})
    return {'commit': COMMIT, 'worker_id': worker_id, 'model_load_secs': round(ready - begun, 2),
            'process_secs': round(begun - STARTED, 2), 'attempts': done}


def put_file(url: str, data: bytes, kind: str) -> None:
    put = urllib.request.Request(url, data=data, method='PUT', headers={'content-type': kind, 'content-length': str(len(data))})
    with urllib.request.urlopen(put, timeout=120) as r:
        if r.status >= 300:
            raise RuntimeError(f'upload: {r.status}')


# The end card is drawn first in the web service's line; while it draws, the service answers 503 with
# Retry-After and the run asks again (NerdCider, 64d5e85). Waiting isn't a failed try (item 102): only a
# real failure, or a card still not drawn after CARD_WAIT_S, is. The lease is 300 s.
CARD_WAIT_S = 150


def fetch_card(path: str, wait_s: float = CARD_WAIT_S, open_url=None, sleep=time.sleep, clock=time.monotonic) -> bytes:
    """Her end card's PNG, asking again while the web service says it's still being drawn."""
    open_url = open_url or (lambda u: urllib.request.urlopen(u, timeout=60))
    until = clock() + wait_s
    while True:
        try:
            with open_url(APP_URL + path) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 503:
                raise
            try:
                after = float(e.headers.get('Retry-After') or 3)
            except ValueError:
                after = 3.0
            after = min(max(after, 1.0), 30.0)
            if clock() + after > until:
                raise RuntimeError(f'end card not drawn in {wait_s:.0f} s') from e
            sleep(after)


def one_clip(job: dict) -> dict:
    """One lift clip: her attempt and her story card in, the MP4 PUT to R2."""
    t0 = time.monotonic()
    if job.get('fault'):
        raise RuntimeError('FAULT=clip set')  # staging's forced failure (item 102)
    with tempfile.TemporaryDirectory() as d:
        video = os.path.join(d, 'attempt')
        urllib.request.urlretrieve(job['video_url'], video)
        card = Image.open(io.BytesIO(fetch_card(job['card_path'])))
        card.load()
        out = os.path.join(d, 'clip.mp4')
        poster = os.path.join(d, 'poster.jpg') if job.get('poster_url') else None
        made = clip.render(job, video, card, out, d, poster)
        # the poster first: the clip being in R2 is what makes it `ready`
        if poster:
            put_file(job['poster_url'], Path(poster).read_bytes(), 'image/jpeg')
        data = Path(out).read_bytes()
        put_file(job['upload_url'], data, 'video/mp4')
    return {**made, 'bytes': len(data), 'secs': round(time.monotonic() - t0, 2)}


def clip_or_report(job: dict, run=None) -> dict:
    """One clip; whatever happens, the web service hears how it went (a failure is tried once more there)."""
    try:
        out = (run or one_clip)(job)
        status, _ = post('/api/internal/clip', {'attempt_id': job['attempt_id'], 'worker_id': job['worker_id'], 'ok': True,
                                                'secs': out.get('secs'), 'bytes': out.get('bytes'), 'commit': COMMIT})
        return {'attempt_id': job['attempt_id'], **out, 'posted': status}
    except Exception as e:  # noqa: BLE001 - one bad clip never stops the run
        why = f'{type(e).__name__}: {e}'[:300]
        post('/api/internal/clip', {'attempt_id': job['attempt_id'], 'worker_id': job['worker_id'], 'ok': False, 'error': why, 'commit': COMMIT})
        return {'attempt_id': job['attempt_id'], 'error': why}


@app.task(timeout_seconds=int(WORKER_MAX_S) + 300)
def render_clip(ctx: TaskContext, worker_id: str) -> dict:
    begun = time.monotonic()
    done: list[dict] = []
    idle_since = time.monotonic()
    try:
        while time.monotonic() - begun < WORKER_MAX_S:
            status, job = post('/api/internal/clip-job', {'worker_id': worker_id})
            if status == 200 and job and job.get('attempt_id'):
                job['worker_id'] = worker_id
                done.append(clip_or_report(job))
                idle_since = time.monotonic()
                continue
            if time.monotonic() - idle_since >= WORKER_IDLE_S:
                break
            time.sleep(1)
    finally:
        post('/api/internal/worker-done', {'worker_id': worker_id, 'commit': COMMIT, 'attempts': len(done)})
    return {'commit': COMMIT, 'worker_id': worker_id, 'process_secs': round(begun - STARTED, 2), 'clips': done}


BENCH_POSE_FPS = rf.BENCH_POSE_FPS


def put_frame(url: str, data: bytes, n: int) -> None:
    put = urllib.request.Request(url, data=data, method='PUT', headers={'content-type': 'image/jpeg', 'content-length': str(len(data))})
    with urllib.request.urlopen(put, timeout=60) as r:
        if r.status >= 300:
            raise RuntimeError(f'upload {n}: {r.status}')


def one_spot_frames(job: dict) -> dict:
    """3.4d steps 1 and 8: a spot check's frames, two from each of her clips, stamped with the attempt."""
    t0 = time.monotonic()
    urls = job['upload_urls']
    out = []
    with tempfile.TemporaryDirectory() as d:
        for i, clip in enumerate(job['clips']):
            video = os.path.join(d, f'clip{i}')
            urllib.request.urlretrieve(clip['video_url'], video)
            for t, data in rf.make_spot_frames(video, clip):
                n = len(out)
                if n >= len(urls):
                    break
                put_frame(urls[n], data, n)
                out.append({'n': n, 't_ms': t, 'attempt_id': clip['attempt_id'], 'sha256': hashlib.sha256(data).hexdigest()})
    return {'frames': out, 'bench_way': None, 'secs': round(time.monotonic() - t0, 2)}


def one_referee_frames(job: dict) -> dict:
    """3.4d step 1: the attempt's frames, picked, stamped and PUT to R2 (the web service says where)."""
    if job.get('clips') is not None:
        return one_spot_frames(job)
    t0 = time.monotonic()
    commands = [(int(t), w) for t, w in job['commands']]
    urls = job['upload_urls']
    with tempfile.TemporaryDirectory() as d:
        video = os.path.join(d, 'attempt')
        urllib.request.urlretrieve(job['video_url'], video)
        frames, how = rf.make_frames(video, commands, job.get('moments') or [], job.get('bench'), cap=min(rf.CAP, len(urls)))
        out = []
        for n, (t, data) in enumerate(frames):
            put = urllib.request.Request(urls[n], data=data, method='PUT', headers={'content-type': 'image/jpeg', 'content-length': str(len(data))})
            with urllib.request.urlopen(put, timeout=60) as r:
                if r.status >= 300:
                    raise RuntimeError(f'upload {n}: {r.status}')
            out.append({'n': n, 't_ms': t, 'sha256': hashlib.sha256(data).hexdigest()})
    return {'frames': out, 'bench_way': how and how['way'], 'secs': round(time.monotonic() - t0, 2)}


def referee_frames_or_report(job_id: str, run=None) -> dict:
    """Whatever happens, the web service hears: the frames, or why there are none."""
    try:
        status, job = post('/api/internal/referee-frames-job', {'job_id': job_id})
        if status != 200 or not job or not (job.get('video_url') or job.get('clips')):
            return {'job_id': job_id, 'skipped': status}
        if job.get('fault'):
            raise RuntimeError('FAULT=referee set')
        out = (run or one_referee_frames)(job)
        posted, _ = post('/api/internal/referee-frames', {'job_id': job_id, 'ok': True, 'frames': out['frames'],
                                                         'bench_way': out.get('bench_way'), 'secs': out.get('secs'), 'commit': COMMIT})
        return {'job_id': job_id, 'frames': len(out['frames']), 'posted': posted}
    except Exception as e:  # noqa: BLE001 - the web service decides what a failure means
        why = f'{type(e).__name__}: {e}'[:300]
        post('/api/internal/referee-frames', {'job_id': job_id, 'ok': False, 'error': why, 'commit': COMMIT})
        return {'job_id': job_id, 'error': why}


@app.task(timeout_seconds=600)
def referee_frames(ctx: TaskContext, job_id: str) -> dict:
    return {'commit': COMMIT, **referee_frames_or_report(job_id)}


@app.task(timeout_seconds=900)
def find_clip(ctx: TaskContext, clip: str, times_ms: list[int] | None = None, split_ms: int | None = None, fps: int = 0) -> dict:
    """One test clip from tests/clips/ (by name, no .webm), or a timing clip by its name in
    timing_clip.CLIPS. `fps` > 0 means that whole grid."""
    begun = time.monotonic()
    process_secs = round(begun - STARTED, 2)  # time from this process starting to the task starting
    name = Path(clip).name.replace('.webm', '')
    path = ROOT / 'tests' / 'clips' / f'{name}.webm'
    make_secs = None
    if name in timing_clip.CLIPS:
        path = Path(tempfile.gettempdir()) / f'{name}.mp4'
        if not path.is_file():
            timing_clip.make(name, path)
        make_secs = round(time.monotonic() - begun, 2)
        begun = time.monotonic()
    if not path.is_file():
        raise ValueError(f'no test clip called {name}')
    poses.pool()
    ready = time.monotonic()
    info = poses.clip_info(str(path))
    times = poses.grid(info.duration, fps) if fps else list(times_ms or [])
    frames = poses.find_split(str(path), times, split_ms if split_ms is not None else (poses.middle(times) if fps else None))
    done = time.monotonic()
    raw = json.dumps({'w': info.w, 'h': info.h, 'duration': info.duration, 'frames': frames}, separators=(',', ':')).encode()
    return {
        'commit': COMMIT, 'clip': name, 'frames': len(frames),
        'process_secs': process_secs,
        'model_load_secs': round(ready - begun, 2),  # 0 when the pool was already warm
        'pose_secs': round(done - ready, 2),
        'make_secs': make_secs,  # making a timing clip, before any of the times above
        'cpus': os.cpu_count(), 'affinity': len(os.sched_getaffinity(0)),
        'points_gz_b64': base64.b64encode(gzip.compress(raw)).decode(),
    }


if __name__ == '__main__':
    app.start()
