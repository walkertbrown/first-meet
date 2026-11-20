"""The bench's touch and lockout for the referee bot's frames (plan 3.4d step 1, "the bar path first").

No imports beyond the standard library, so the committed reference check (tests/referee-bot) runs it in CI
without MediaPipe. Times are ms from the attempt's start; y is a fraction of the frame's height, growing down.

The ways in, in order:
1. `path`: the saved bar path (`attempts.barKey`). Its touch is its lowest point from "Start!" to "Press!" (or
   "Rack!", or the end), its lockout its top after the touch, to "Press!" + 3 s or "Rack!". It's usable when it isn't
   lost before "Press!" (or "Rack!") and has a point on at least 80% of the frames from "Start!" to the touch. A
   point counts only at confidence 0.5 or more. If it's lost after that, the lockout uses the wrists after the loss.
2. `partway`: a path lost before "Press!" (or "Rack!"): its points before the loss and the wrists' after it.
3. `wrists`: the wrists alone, when seen on at least half the frames from "Start!" to "Press!" (or "Rack!").
4. `window`: neither; the worker sends fixed spans of every frame instead.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

PATH_SCORE = 0.5      # a path point counts at this confidence or more (the plan's guess)
PATH_COVER = 0.8      # of the frames from Start! to the touch (the plan's guess)
WRISTS_SEEN = 0.5     # of the pose frames from Start! to Press! (or Rack!)
# The path is lost when it has no point that counts for its last LOST_MS or more before the window's end.
# The plan doesn't give a number; this is Buildnanafest's.
LOST_MS = 500
LOCKOUT_MS = 3000     # the lockout is looked for to Press! + 3 s
FRAME_MS = 1000 / 15  # the server's frames, when the path is too short to tell
# the smoothing window, from shared/rules.json (benchBar.smoothMs), and measureBar's slack (SMOOTH_SLACK_MS)
SMOOTH_MS = json.loads((Path(__file__).resolve().parent.parent / 'shared/rules.json').read_text())['benchBar']['smoothMs']
SMOOTH_SLACK_MS = 5

Series = list[tuple[float, float]]


def _smooth(pts: Series) -> Series:
    """The median of y over every point within SMOOTH_MS either side, as measureBar smooths the path
    (web/lib/judge/bar-measure.ts, 3.4b "The smoothing is in time, not points"). At 15 fps that's 3 points."""
    half = SMOOTH_MS + SMOOTH_SLACK_MS
    out = []
    a = b = 0
    for i, (t, _) in enumerate(pts):
        while t - pts[a][0] > half:
            a += 1
        b = max(b, i)
        while b + 1 < len(pts) and pts[b + 1][0] - t <= half:
            b += 1
        w = sorted(y for _, y in pts[a:b + 1])
        out.append((t, w[len(w) // 2]))
    return out


def _step(path: list) -> float:
    ts = sorted(p[0] for p in path)
    d = sorted(b - a for a, b in zip(ts, ts[1:]) if b > a)
    return d[len(d) // 2] if d else FRAME_MS


def _low(s: Series, a: float, b: float) -> float | None:
    win = [p for p in s if a <= p[0] <= b]
    return max(win, key=lambda p: p[1])[0] if len(win) >= 3 else None


def _top(s: Series, a: float, b: float) -> float | None:
    win = [p for p in s if a < p[0] <= b]
    return min(win, key=lambda p: p[1])[0] if win else None


def wrist_y(f: dict) -> float | None:
    """The wrists' height on one pose frame (MediaPipe 15 and 16, visibility 0.5 or more), or None."""
    p = f.get('p')
    if not p:
        return None
    ys = [p[i][1] for i in (15, 16) if p[i][2] >= 0.5]
    return sum(ys) / len(ys) if ys else None


def _joined(path_s: Series, lost: float, wr: Series) -> Series:
    """The path's points before the loss and the wrists' after it, the wrists moved to meet the path at the loss
    (the plate and the wrists move together, at different heights)."""
    before = [p for p in path_s if p[0] < lost]
    after = [p for p in wr if p[0] >= lost]
    if not before or not after:
        return before
    t_last, y_last = before[-1]
    near = [y for t, y in wr if abs(t - t_last) <= 200]
    if not near:
        near = [after[0][1]]
    shift = y_last - sum(near) / len(near)
    return before + [(t, y + shift) for t, y in after]


def bench_way(path: list | None, wrists: Callable[[], list[dict]], start: int, press: int | None,
              rack: int | None, duration: int) -> dict:
    """Which way the touch is found, and where. `path`: [[t, y, score], ...] or None. `wrists()` runs the poses only
    when they're needed and returns [{'t', 'p'}] on every pose frame from Start! to the window's end.

    Returns {'way', 'touch', 'lockout', 'cover', 'lost'}: touch and lockout in ms (lockout may be None),
    `cover` the path's share of frames from Start! to its touch, `lost` where the path was lost (or None)."""
    touch_end = press if press is not None else (rack if rack is not None else duration)
    end = min(duration, press + LOCKOUT_MS, rack if rack is not None else duration) if press is not None \
        else min(duration, rack if rack is not None else duration)
    out = {'way': 'window', 'touch': None, 'lockout': None, 'cover': None, 'lost': None}

    pts = sorted((p[0], p[1]) for p in (path or []) if p[2] >= PATH_SCORE)
    s = _smooth(pts)
    lost = None
    if path:
        step = _step(path)
        inside = [t for t, _ in pts if start <= t <= end]
        last = inside[-1] if inside else None
        if last is None:
            lost = start
        elif end - last >= LOST_MS:
            lost = last + step
        out['lost'] = lost
        low = _low([p for p in s if lost is None or p[0] < lost], start, touch_end)
        if low is not None:
            frames = round((low - start) / step) + 1
            cover = sum(1 for t, _ in pts if start <= t <= low) / max(1, frames)
            out['cover'] = round(cover, 3)
            if (lost is None or lost > touch_end) and cover >= PATH_COVER:
                if lost is None:
                    top = _top(s, low, end)
                else:
                    top = _top(_joined(s, lost, _wrist_series(wrists())), low, end)
                return {**out, 'way': 'path', 'touch': int(low), 'lockout': None if top is None else int(top)}

    frames = wrists()
    wr = _wrist_series(frames)

    def seen(a: float, b: float) -> bool:
        grid = [f for f in frames if a <= f['t'] <= b]
        return bool(grid) and sum(1 for f in grid if wrist_y(f) is not None) >= WRISTS_SEEN * len(grid)

    if path and lost is not None and start < lost <= touch_end and seen(lost, touch_end):
        before = [t for t, _ in pts if start <= t < lost]
        cover = len(before) / max(1, round((lost - start) / _step(path)))
        if cover >= PATH_COVER:
            j = _joined(s, lost, wr)
            low = _low(j, start, touch_end)
            if low is not None:
                top = _top(j, low, end)
                return {**out, 'way': 'partway', 'touch': int(low), 'lockout': None if top is None else int(top)}
    if seen(start, touch_end):
        low = _low(wr, start, touch_end)
        if low is not None:
            top = _top(wr, low, end)
            return {**out, 'way': 'wrists', 'touch': int(low), 'lockout': None if top is None else int(top)}
    return out


def _wrist_series(frames: list[dict]) -> Series:
    """The wrists' heights, smoothed as the path is: one jittery frame shouldn't decide the touch."""
    return _smooth(sorted((f['t'], y) for f in frames if (y := wrist_y(f)) is not None))
