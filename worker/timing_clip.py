"""Clips for timing only, made from the repo's test clips (plan 2.3: "The 20-rep Home time is
measured on a test clip looped to 90 s, for timing only").

They're made the way a phone records an attempt (H.264 at 1.5 Mbps, 720 px tall, 30 frames a
second, a keyframe each second), so decoding costs what it will for a real upload. They're made
when asked for, never kept in the repo:

  python worker/timing_clip.py timing-home-90s out.mp4
"""
from __future__ import annotations

import sys
from fractions import Fraction
from pathlib import Path

CLIPS_DIR = Path(__file__).resolve().parent.parent / 'tests' / 'clips'

# name: (test clip, keep every nth frame, seconds)
CLIPS = {
    # A 30-second Barbell attempt: five side-on squats.
    'timing-barbell-30s': ('racked-squats-side', 1, 30.0),
    # A 20-rep, 90 s Home attempt: two half squats every 17 s, played at double speed (a rep
    # about every 4 s) and looped to 90 s, about 21 reps.
    'timing-home-90s': ('half-squat', 2, 90.0),
}

FPS = 30
HEIGHT = 720
BIT_RATE = 1_500_000


def make(name: str, out: str | Path, clips: dict | None = None) -> Path:
    import av
    src, every, seconds = (clips or CLIPS)[name]
    out = Path(out)
    want = round(seconds * FPS)
    n = 0
    with av.open(str(out), 'w') as o:
        v = o.add_stream('libx264', rate=FPS)
        v.bit_rate = BIT_RATE
        v.pix_fmt = 'yuv420p'
        v.codec_context.gop_size = FPS
        v.codec_context.time_base = Fraction(1, FPS)
        while n < want:
            with av.open(str(CLIPS_DIR / f'{src}.webm')) as c:
                s = c.streams.video[0]
                if n == 0:
                    v.height = HEIGHT
                    v.width = round(s.width * HEIGHT / s.height / 2) * 2
                for k, frame in enumerate(c.decode(s)):
                    if k % every:
                        continue
                    f = frame.reformat(width=v.width, height=v.height, format='yuv420p')
                    f.pts, f.time_base = n, Fraction(1, FPS)
                    for pkt in v.encode(f):
                        o.mux(pkt)
                    n += 1
                    if n >= want:
                        break
        o.mux(v.encode(None))
    return out


if __name__ == '__main__':
    print(make(sys.argv[1], sys.argv[2]))
