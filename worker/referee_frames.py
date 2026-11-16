"""The referee bot's still frames (plan 3.4d step 1).

The web service says which attempt, its commands and the moments that matter (the judge's reps);
this picks the frames, burns the time and the last command into each one (LookieBot's 5.14d),
and returns them as JPEGs 512 px wide at quality 80.

Which frames:
- 2 a second from the first command to "Rack!" (or the end);
- every frame from 0.4 s before to 0.4 s after each moment (each rep's bottom and lockout);
- on the bench, every frame from the bar's lowest point to 0.3 s after "Press!" (the pause).
  The bench's moments come from poses run here: the wrists' lowest point between "Start!" and
  "Press!", and their top after "Press!". With no usable poses: every frame from 1.0 s before
  "Press!" to 0.5 s after, and from 0.6 s before "Rack!".
- At most 60: the 2-a-second frames thin evenly first, then the moments of reps the judge passed
  cleanly. The flagged rep's frames are always kept.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CAP = 60
EVERY_MS = 500
AROUND_MS = 400
WIDTH = 512
QUALITY = 80
# 5.14d: #F1EFE8 with a 2 px #0D0E13 outline, Atkinson Hyperlegible Next 700 at 22 px, 12 px in
INK = (0xF1, 0xEF, 0xE8)
OUTLINE = (0x0D, 0x0E, 0x13)
TEXT_PX = 22
INSET = 12
FONT = Path(__file__).resolve().parent.parent / 'web' / 'card-fonts' / 'atkinson-700.ttf'

# priorities when thinning: lower goes first
EVERY, CLEAN, FLAGGED = 0, 1, 2


@dataclass(order=True)
class Pick:
    t_ms: int
    keep: int = field(default=EVERY, compare=False)


def frame_times(fps: float, duration_ms: int) -> list[int]:
    """The clip's frame times, from its rate (the decoder later shows the frame at or before each)."""
    step = 1000 / max(1.0, fps)
    n = int(duration_ms / step) + 1
    return [round(i * step) for i in range(n)]


def pick(fps: float, duration_ms: int, commands: list[tuple[int, str]], moments: list[dict],
         pause: tuple[int, int] | None = None, fallback: list[tuple[int, int]] | None = None, cap: int = CAP) -> list[int]:
    """The frame times to send, sorted. `commands`: [(ms, word)], in time order. `moments`: [{ms, flagged}].
    `pause`: the bench's (lowest point, "Press!") when poses found it; `fallback`: spans of every frame."""
    frames = frame_times(fps, duration_ms)
    first = commands[0][0] if commands else 0
    rack = next((t for t, w in commands if w in ('Rack!', 'Down!')), duration_ms)
    got: dict[int, int] = {}

    def add(t: int, keep: int) -> None:
        t = max(0, min(duration_ms, t))
        got[t] = max(got.get(t, -1), keep)

    t = first
    while t <= rack:
        add(t, EVERY)
        t += EVERY_MS
    for m in moments:
        keep = FLAGGED if m.get('flagged') else CLEAN
        for f in frames:
            if m['ms'] - AROUND_MS <= f <= m['ms'] + AROUND_MS:
                add(f, keep)
    spans = list(fallback or [])
    if pause:
        spans.append((pause[0], pause[1] + 300))
    for a, b in spans:
        for f in frames:
            if a <= f <= b:
                add(f, FLAGGED)
    # two picks closer than half a frame show the same frame: keep the more important
    step = 1000 / max(1.0, fps)
    merged: dict[int, int] = {}
    for t in sorted(got):
        near = next((k for k in merged if abs(k - t) < step / 2), None)
        if near is None:
            merged[t] = got[t]
        else:
            merged[near] = max(merged[near], got[t])
    return sorted(thin(merged, cap))


def thin(got: dict[int, int], cap: int) -> list[int]:
    """Drop the least important evenly until `cap` are left: the 2-a-second ones, then clean reps'."""
    out = dict(got)
    for level in (EVERY, CLEAN):
        over = len(out) - cap
        if over <= 0:
            break
        ts = sorted(t for t, k in out.items() if k == level)
        if not ts:
            continue
        drop = min(over, len(ts))
        keep_n = len(ts) - drop
        # keep `keep_n` spread evenly over the level's frames
        kept = {ts[round(i * (len(ts) - 1) / (keep_n - 1))] for i in range(keep_n)} if keep_n > 1 else ({ts[len(ts) // 2]} if keep_n == 1 else set())
        for t in ts:
            if t not in kept:
                del out[t]
    return list(out)


def last_command(t_ms: int, commands: list[tuple[int, str]]) -> str | None:
    word = None
    for at, w in commands:
        if at <= t_ms:
            word = w
    return word


def label(t_ms: int, commands: list[tuple[int, str]]) -> list[str]:
    lines = [f'{t_ms / 1000:.2f} s']
    w = last_command(t_ms, commands)
    if w:
        lines.append(f'after {w}')
    return lines


def burn(img: Image.Image, lines: list[str]) -> Image.Image:
    """512 px wide, the time and the command at the top left (5.14d)."""
    w, h = img.size
    out = img.convert('RGB').resize((WIDTH, max(1, round(h * WIDTH / w))), Image.Resampling.LANCZOS)
    d = ImageDraw.Draw(out)
    font = ImageFont.truetype(str(FONT), TEXT_PX)
    y = INSET
    for line in lines:
        d.text((INSET, y), line, font=font, fill=INK, stroke_width=2, stroke_fill=OUTLINE, anchor='lt')
        y += round(TEXT_PX * 1.25)
    return out


def jpeg(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=QUALITY)
    return buf.getvalue()


def bench_moments(points: list[dict], start_ms: int, press_ms: int) -> tuple[int, int | None] | None:
    """From poses: the wrists' lowest point between "Start!" and "Press!" (image y grows down), and their top after."""
    def wrist_y(f):
        p = f.get('p')
        if not p:
            return None
        ys = [p[i][1] for i in (15, 16) if p[i][2] >= 0.5]
        return sum(ys) / len(ys) if ys else None
    before = [(f['t'], y) for f in points if start_ms <= f['t'] <= press_ms and (y := wrist_y(f)) is not None]
    after = [(f['t'], y) for f in points if f['t'] > press_ms and (y := wrist_y(f)) is not None]
    if len(before) < 3:
        return None
    low = max(before, key=lambda x: x[1])[0]
    top = min(after, key=lambda x: x[1])[0] if after else None
    return low, top


BENCH_POSE_FPS = 15


def make_frames(video: str, commands: list[tuple[int, str]], moments: list[dict], bench: dict | None,
                cap: int = CAP) -> tuple[list[tuple[int, bytes]], bool | None]:
    """One attempt's frames from a clip on disk: [(t_ms, jpeg)] in time order, and whether the bench's
    poses were usable (None off the bench). The worker's job and tests/referee-bot/recut.py both run
    this, so the referee bot test sees exactly the frames the product sends."""
    import av
    import poses
    info = poses.clip_info(video)
    with av.open(video) as c:
        rate = c.streams.video[0].average_rate
    fps = min(float(rate) if rate else 15.0, 15.0)
    duration_ms = int(info.duration * 1000)
    moments = list(moments or [])
    pause = None
    fallback = None
    if bench:
        press = int(bench['press_ms'])
        grid = poses.grid(info.duration, BENCH_POSE_FPS, int(bench['start_ms']), min(duration_ms, press + 3000))
        found = bench_moments(poses.find_at(video, grid), int(bench['start_ms']), press)
        if found:
            low, top = found
            pause = (low, press)
            moments.append({'ms': low, 'flagged': True})
            if top is not None:
                moments.append({'ms': top, 'flagged': True})
        else:
            rack = bench.get('rack_ms')
            fallback = [(press - 1000, press + 500)] + ([(int(rack) - 600, int(rack))] if rack is not None else [])
    times = pick(fps, duration_ms, commands, moments, pause=pause, fallback=fallback, cap=cap)
    out = [(t, jpeg(burn(img, label(t, commands)))) for t, img in zip(times, grab(video, times))]
    return out, (bool(pause) if bench else None)


def grab(path: str, times_ms: list[int]) -> list[Image.Image]:
    """The frame showing at each time (the one at or before it), upright."""
    import av
    import numpy as np
    times = sorted(times_ms)
    out: list[Image.Image] = []
    with av.open(path) as c:
        s = c.streams.video[0]
        s.thread_type = 'AUTO'
        prev = None
        i = 0
        for frame in c.decode(s):
            start = float(frame.pts * s.time_base) if frame.pts is not None else float(frame.time or 0)
            while i < len(times) and times[i] / 1000 < start - 1e-6:
                out.append(_upright(prev if prev is not None else frame, np))
                i += 1
            if i >= len(times):
                break
            prev = frame
        while i < len(times) and prev is not None:
            out.append(_upright(prev, np))
            i += 1
    return out


def _upright(frame, np) -> Image.Image:
    from poses import _rotation
    arr = frame.to_ndarray(format='rgb24')
    rot = _rotation(frame)
    if rot:
        arr = np.ascontiguousarray(np.rot90(arr, k=rot // 90))
    return Image.fromarray(arr)
