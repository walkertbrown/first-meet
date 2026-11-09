"""Find pose points in a clip at chosen times (plan 2.3).

The same MediaPipe model the site serves (web/public/models/pose_landmarker_full.task),
run in VIDEO mode on one pose. Each point is [x, y, visibility, z], rounded the way
tests/judge/pose-page.ts rounds them, so the one judge reads the same shape from
the phone, from Chromium and from here.

Frames are picked the way a browser shows a seek: the last frame that starts at or
before the time asked for.
"""
from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from multiprocessing import get_context
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODEL = Path(os.environ.get('POSE_MODEL', HERE.parent / 'web/public/models/pose_landmarker_full.task'))

# Seconds before a wanted time that a seek aims for (a seek lands on the keyframe before it).
SEEK_BACK_S = 0.5


@dataclass
class ClipInfo:
    w: int
    h: int
    duration: float
    rotation: int


def _rotation(frame) -> int:
    """Degrees the clip is turned for display (phones record sideways and tag it)."""
    r = getattr(frame, 'rotation', 0) or 0
    return int(r) % 360


def clip_info(path: str) -> ClipInfo:
    import av
    with av.open(path) as c:
        s = c.streams.video[0]
        duration = float(s.duration * s.time_base) if s.duration else float(c.duration or 0) / 1_000_000
        first = next(c.decode(s))
        rot = _rotation(first)
        w, h = first.width, first.height
    if rot in (90, 270):
        w, h = h, w
    return ClipInfo(w=w, h=h, duration=duration, rotation=rot)


def grid(duration: float, fps: int, start_ms: int = 0, end_ms: int | None = None) -> list[int]:
    """Times in ms on an fps grid, the way pose-page.ts steps a clip (stops 20 ms short of the end)."""
    out = []
    k = 0
    last = duration - 0.02
    while True:
        t = k / fps
        if t >= last:
            break
        ms = round(t * 1000)
        if ms >= start_ms and (end_ms is None or ms <= end_ms):
            out.append(ms)
        k += 1
    return out


# One landmarker per process, made once and reused for every clip the process sees.
_lm = None
_clock = 0


def _landmarker():
    global _lm
    if _lm is None:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode
        _lm = PoseLandmarker.create_from_options(PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MODEL), delegate=BaseOptions.Delegate.CPU),
            running_mode=RunningMode.VIDEO,
            num_poses=1,
        ))
        _ = mp
    return _lm


def warm() -> bool:
    """Loads the model in this process, so the first clip doesn't pay for it."""
    _landmarker()
    return True


def _point(q) -> list[float]:
    return [round(q.x, 4), round(q.y, 4), round(q.visibility or 0.0, 3), round(q.z, 4)]


def find_at(path: str, times_ms: list[int]) -> list[dict]:
    """Pose points at each time in `times_ms` (sorted, ms from the clip's start)."""
    global _clock
    if not times_ms:
        return []
    import av
    import mediapipe as mp
    import numpy as np

    lm = _landmarker()
    times = sorted(times_ms)
    out: list[dict] = []
    with av.open(path) as c:
        s = c.streams.video[0]
        s.thread_type = 'AUTO'
        first_s = times[0] / 1000
        if first_s > 0.5:
            c.seek(int(max(0.0, first_s - SEEK_BACK_S) / s.time_base), stream=s, backward=True, any_frame=False)
        i = 0
        prev = None  # (start_s, frame)

        def emit(frame, t_ms):
            arr = frame.to_ndarray(format='rgb24')
            rot = _rotation(frame)
            if rot:
                arr = np.ascontiguousarray(np.rot90(arr, k=rot // 90))
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=arr)
            res = lm.detect_for_video(img, _clock + t_ms)
            p = res.pose_landmarks[0] if res.pose_landmarks else None
            out.append({'t': t_ms, 'p': [_point(q) for q in p] if p else None})

        for frame in c.decode(s):
            start = float(frame.pts * s.time_base) if frame.pts is not None else float(frame.time or 0)
            # every wanted time before this frame starts is shown by the previous frame
            while i < len(times) and times[i] / 1000 < start - 1e-6:
                if prev is not None:
                    emit(prev[1], times[i])
                elif not out:
                    emit(frame, times[i])  # asked for a time before the first frame
                i += 1
            if i >= len(times):
                break
            prev = (start, frame)
        while i < len(times) and prev is not None:
            emit(prev[1], times[i])
            i += 1
    _clock += times[-1] + 1000  # VIDEO mode wants ever-later timestamps, across clips too
    return out


_pool: ProcessPoolExecutor | None = None


def pool(workers: int = 2) -> ProcessPoolExecutor:
    """Two processes, one per CPU, each with its own landmarker (plan 2.3, "split in two")."""
    global _pool
    if _pool is None:
        _pool = ProcessPoolExecutor(max_workers=workers, mp_context=get_context('spawn'))
        list(_pool.map(_warm_one, range(workers)))
    return _pool


def middle(times_ms: list[int]) -> int | None:
    """The first pass splits halfway through its frames."""
    return sorted(times_ms)[len(times_ms) // 2] if len(times_ms) > 1 else None


def _warm_one(_: int) -> bool:
    return warm()


def find_split(path: str, times_ms: list[int], split_ms: int | None) -> list[dict]:
    """Finds poses at `times_ms` in two halves at once, split at `split_ms`; None runs them whole."""
    times = sorted(set(times_ms))
    if not times:
        return []
    if split_ms is None:
        return pool().submit(find_at, path, times).result()
    a = [t for t in times if t < split_ms]
    b = [t for t in times if t >= split_ms]
    p = pool()
    fa = p.submit(find_at, path, a)
    fb = p.submit(find_at, path, b)
    return fa.result() + fb.result()
