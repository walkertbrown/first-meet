"""The Render Workflow that finds poses (plan 2.3, 3.9).

`find_poses(worker_id)` is a worker: it asks the web service for the next waiting
attempt, finds its poses in two passes, posts the points back, and asks again. It never
judges: the one judge (web/lib/judge/) runs in the web service, which also tells it
where the second pass looks.

`find_clip(clip, times_ms, split_ms)` finds poses in one of the repo's test clips at the
times given. It proves the pose finder on Render (piece 6) and measures it; its points
come back gzipped in the result, well under Render's 4 MB cap.

Build: pip install -r worker/requirements.txt    Start: python worker/main.py
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

import poses  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
COMMIT = (os.environ.get('RENDER_GIT_COMMIT') or 'unknown')[:7]
APP_URL = os.environ.get('APP_URL', '').rstrip('/')
WORKER_IDLE_S = float(os.environ.get('WORKER_IDLE_S', 20))
WORKER_MAX_S = float(os.environ.get('WORKER_MAX_S', 15 * 60))
ZOOM_FPS = 15
FIRST_FPS = 5

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


def zoom_times(duration: float, windows: list[list[int]], have: set[int]) -> list[int]:
    """The 15-a-second grid inside each window, less the frames the first pass found."""
    out: set[int] = set()
    for a, b in windows:
        out.update(poses.grid(duration, ZOOM_FPS, max(0, a), b))
    return sorted(out - have)


def one_attempt(job: dict) -> dict:
    """Two passes on one attempt (plan 2.3). The web service judges after pass 2."""
    t0 = time.monotonic()
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, 'clip')
        urllib.request.urlretrieve(job['video_url'], path)
        got = time.monotonic()
        info = poses.clip_info(path)
        first = poses.grid(info.duration, FIRST_FPS)
        f1 = poses.find_split(path, first, poses.middle(first))
        status, zoom = post('/api/internal/poses', {
            'attempt_id': job['attempt_id'], 'worker_id': job.get('worker_id'), 'pass': 1,
            'w': info.w, 'h': info.h, 'duration': info.duration, 'frames': f1,
        })
        if status != 200 or not zoom:
            return {'attempt_id': job['attempt_id'], 'error': f'pass 1 post: {status}'}
        second = zoom_times(info.duration, zoom.get('windows', []), set(first))  # the web service's zoomWindows()
        f2 = poses.find_split(path, second, zoom.get('split_ms'))
        secs = time.monotonic() - t0
        status, _ = post('/api/internal/poses', {
            'attempt_id': job['attempt_id'], 'worker_id': job.get('worker_id'), 'pass': 2,
            'w': info.w, 'h': info.h, 'duration': info.duration, 'frames': f2,
            'commit': COMMIT, 'secs': round(secs, 2), 'download_secs': round(got - t0, 2),
        })
    return {'attempt_id': job['attempt_id'], 'frames': len(f1) + len(f2), 'secs': round(secs, 2), 'posted': status}


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
                done.append(one_attempt(job))
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
    """One test clip from tests/clips/ (by name, no .webm). `fps` > 0 means that whole grid."""
    begun = time.monotonic()
    name = Path(clip).name.replace('.webm', '')
    path = ROOT / 'tests' / 'clips' / f'{name}.webm'
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
        'process_secs': round(begun - STARTED, 2),  # time from this process starting to the task starting
        'model_load_secs': round(ready - begun, 2),  # 0 when the pool was already warm
        'pose_secs': round(done - ready, 2),
        'cpus': os.cpu_count(), 'affinity': len(os.sched_getaffinity(0)),
        'points_gz_b64': base64.b64encode(gzip.compress(raw)).decode(),
    }


if __name__ == '__main__':
    app.start()
