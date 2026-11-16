"""The plate tracker on the server (plan 3.4b): the Python twin of web/lib/judge/plate-tracker.ts.

The phone follows the end of the bar from where she tapped (`plate_tap` in command_times), and
the server follows it again on its own 15-frames-a-second frames, in place of the pose run, so
the referee's page gets the plate's path and the server can measure the pause, "Press! while
sinking" and `shadow_lights`. The same numbers (shared/rules.json, benchBar.tracker) and the
same steps: zero-mean normalised cross-correlation of a square template cut around the tap,
searched +-8% of the frame around the last place on a 160 px tall grey frame, a parabola for
the sub-pixel place, and the template following slowly when the match is strong.

JavaScript's Math.round is floor(x + 0.5), and its template is a Float32Array, so both are kept
here. tests/worker/plate.test.ts runs the two on the same grey frames and checks they agree.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

HERE = Path(__file__).resolve().parent
_RULES = json.loads((HERE.parent / 'shared/rules.json').read_text())
TRACKER = _RULES['benchBar']['tracker']
FRAME_H: int = TRACKER['frameH']
FPS = 15


def js_round(x: float) -> int:
    """JavaScript's Math.round: halves go up, -2.5 to -2."""
    return math.floor(x + 0.5)


@dataclass
class TrackOpts:
    tpl: float = TRACKER['tpl']
    search: float = TRACKER['search']
    follow: float = TRACKER['follow']
    follow_min: float = TRACKER['followMin']


class PlateTracker:
    def __init__(self, f: np.ndarray, fx: float, fy: float, o: TrackOpts | None = None):
        self.o = o or TrackOpts()
        h, w = f.shape
        self.n = max(7, js_round(self.o.tpl * h) | 1)
        self.r = max(3, js_round(self.o.search * h))
        self.x = fx * w
        self.y = fy * h
        self.t = self._cut(f, js_round(self.x), js_round(self.y)).astype(np.float32)
        self._norm()

    def _cut(self, f: np.ndarray, cx: int, cy: int) -> np.ndarray:
        n, hh = self.n, self.n >> 1
        h, w = f.shape
        ys = np.clip(np.arange(cy - hh, cy - hh + n), 0, h - 1)
        xs = np.clip(np.arange(cx - hh, cx - hh + n), 0, w - 1)
        return f[np.ix_(ys, xs)].astype(np.float64)

    def _norm(self) -> None:
        t = self.t.astype(np.float64)
        self.tm = float(t.sum() / t.size)
        v = float(((t - self.tm) ** 2).sum())
        self.tn = math.sqrt(v) or 1.0

    def score(self, f: np.ndarray, cx: int, cy: int) -> float:
        """Score of the template centred at (cx, cy): -1..1, or -2 off the frame."""
        n, hh = self.n, self.n >> 1
        h, w = f.shape
        x0, y0 = cx - hh, cy - hh
        if x0 < 0 or y0 < 0 or x0 + n > w or y0 + n > h:
            return -2.0
        p = f[y0:y0 + n, x0:x0 + n].astype(np.float64)
        s, s2 = p.sum(), (p * p).sum()
        st = (p * (self.t.astype(np.float64) - self.tm)).sum()
        v = s2 - s * s / (n * n)
        return 0.0 if v <= 1e-6 else float(st / (math.sqrt(v) * self.tn))

    def _scores(self, f: np.ndarray, cx: int, cy: int) -> np.ndarray:
        """Every score in the search square, rows dy = -r..r, columns dx = -r..r."""
        n, hh, r = self.n, self.n >> 1, self.r
        h, w = f.shape
        out = np.full((2 * r + 1, 2 * r + 1), -2.0)
        # top-left corners that keep the template on the frame
        ya, yb = max(cy - r - hh, 0), min(cy + r - hh, h - n)
        xa, xb = max(cx - r - hh, 0), min(cx + r - hh, w - n)
        if ya > yb or xa > xb:
            return out
        win = sliding_window_view(f, (n, n))[ya:yb + 1, xa:xb + 1].astype(np.float64)
        s = win.sum(axis=(2, 3))
        s2 = (win * win).sum(axis=(2, 3))
        st = np.einsum('abij,ij->ab', win, self.t.astype(np.float64) - self.tm)
        v = s2 - s * s / (n * n)
        with np.errstate(invalid='ignore', divide='ignore'):
            sc = np.where(v <= 1e-6, 0.0, st / (np.sqrt(np.maximum(v, 1e-12)) * self.tn))
        oy, ox = ya - (cy - r - hh), xa - (cx - r - hh)
        out[oy:oy + sc.shape[0], ox:ox + sc.shape[1]] = sc
        return out

    def track(self, f: np.ndarray) -> tuple[float, float, float]:
        """Follow the plate into frame f: its centre as fractions of the frame, and the match score."""
        h, w = f.shape
        cx, cy, r = js_round(self.x), js_round(self.y), self.r
        sc = self._scores(f, cx, cy)
        k = int(np.argmax(sc))  # the first best, in the TS loop's order (dy, then dx)
        best = float(sc.flat[k])
        by, bx = cy + k // (2 * r + 1) - r, cx + k % (2 * r + 1) - r

        def at(x: int, y: int) -> float:
            if abs(x - cx) <= r and abs(y - cy) <= r:
                return float(sc[y - cy + r, x - cx + r])
            return self.score(f, x, y)

        def sub(a: float, b: float, c: float) -> float:
            d = a - 2 * b + c
            return max(-0.5, min(0.5, (a - c) / (2 * d))) if d < 0 else 0.0

        fx = bx + sub(at(bx - 1, by), best, at(bx + 1, by))
        fy = by + sub(at(bx, by - 1), best, at(bx, by + 1))
        if best > -2:
            self.x, self.y = fx, fy
        if best >= self.o.follow_min and self.o.follow > 0:
            p = self._cut(f, bx, by)
            a = self.o.follow
            self.t = ((1 - a) * self.t.astype(np.float64) + a * p).astype(np.float32)
            self._norm()
        return self.x / w, self.y / h, best


def small_size(w: int, h: int, frame_h: int = FRAME_H) -> tuple[int, int]:
    """The small grey frame for a clip shown w x h: frame_h tall, its width to the same shape."""
    return max(1, js_round(frame_h * w / h)), frame_h


def grey_frames(path: str, times_ms: list[int], frame_h: int = FRAME_H):
    """Yields (t, grey frame) at each time, the frame shown then (as poses.find_at picks it),
    turned upright, frame_h px tall."""
    import av
    from poses import _rotation

    times = sorted(times_ms)
    if not times:
        return
    with av.open(path) as c:
        s = c.streams.video[0]
        s.thread_type = 'AUTO'
        i = 0
        prev = None

        def small(frame) -> np.ndarray:
            rot = _rotation(frame)
            sw, sh = (frame.height, frame.width) if rot in (90, 270) else (frame.width, frame.height)
            w, h = small_size(sw, sh, frame_h)
            # resized as stored, then turned, so it lands frame_h tall
            arr = frame.reformat(width=h if rot in (90, 270) else w, height=w if rot in (90, 270) else h,
                                 format='gray', interpolation='AREA').to_ndarray()
            if rot:
                arr = np.rot90(arr, k=rot // 90)
            return np.ascontiguousarray(arr, dtype=np.uint8)

        cache: dict[int, np.ndarray] = {}

        def shown(frame) -> np.ndarray:
            key = id(frame)
            if key not in cache:
                cache.clear()
                cache[key] = small(frame)
            return cache[key]

        for frame in c.decode(s):
            start = float(frame.pts * s.time_base) if frame.pts is not None else float(frame.time or 0)
            while i < len(times) and times[i] / 1000 < start - 1e-6:
                yield times[i], shown(prev if prev is not None else frame)
                i += 1
            if i >= len(times):
                break
            prev = frame
        while i < len(times) and prev is not None:
            yield times[i], shown(prev)
            i += 1


def track_frames(frames, tap: dict) -> list[list[float]]:
    """The plate's path from the tap: [t ms, x, y, score] a frame, x and y fractions of the
    frame (the shape of tests/bench-commands/data/traces). The first frame is where she tapped."""
    o = TrackOpts(tpl=float(tap['size'])) if tap.get('size') else TrackOpts()
    tr: PlateTracker | None = None
    out: list[list[float]] = []
    for t, f in frames:
        if tr is None:
            tr = PlateTracker(f, float(tap['x']), float(tap['y']), o)
            out.append([t, round(tap['x'], 5), round(tap['y'], 5), 1.0])
            continue
        x, y, sc = tr.track(f)
        out.append([t, round(x, 5), round(y, 5), round(sc, 4)])
    return out


def track_clip(path: str, tap: dict, duration: float, start_ms: int = 0) -> list[list[float]]:
    """The plate's path on the server's 15 fps frames, from `start_ms` (her tap) to the end."""
    from poses import grid
    return track_frames(grey_frames(path, grid(duration, FPS, start_ms)), tap)
