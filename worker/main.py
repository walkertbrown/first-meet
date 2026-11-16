"""The Render Workflow that finds poses (plan 2.3, 3.9).

`find_poses(worker_id)` is a worker: it asks the web service for the next waiting
attempt, finds its poses in two passes, posts the points back, and asks again. It never
judges: the one judge (web/lib/judge/) runs in the web service, which also tells it
where the second pass looks.

A Barbell bench (plan 3.4b) comes with `track: 'bar'` and her `plate_tap`: in place of the
pose run, the worker follows the plate from the tap on its 15-a-second frames
(worker/plate.py, the phone's tracker in Python) and posts the path to /api/internal/bar.

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
import json
import os
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

STARTED = time.monotonic()
sys.path.insert(0, str(Path(__file__).resolve().parent))

from render import Retry, TaskContext, Workflows  # noqa: E402

import plate  # noqa: E402
import poses  # noqa: E402
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
        bar = plate.track_clip(path, job['plate_tap'], info.duration)
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
