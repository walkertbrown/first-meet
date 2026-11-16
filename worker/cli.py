"""Find poses in a local clip and print them as JSON, in the shape tests/clips/poses/ uses.

  python worker/cli.py tests/clips/half-squat.webm --fps 15
  python worker/cli.py clip.webm --times 0,200,400 --split 200
  python worker/cli.py clip.mp4 --pass1                                 # the live server's pass 1
  python worker/cli.py clip.mp4 --windows '[[300,2050]]' --split 1100   # and its pass 2
  python worker/cli.py clip.mp4 --pass1 --after other.webm             # pass 1 after another clip, as a warm worker

Used by scripts/worker-check.ts to prove the worker on the six test clips (piece 6).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import poses  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('clip')
    ap.add_argument('--fps', type=int, default=0, help='every frame on this grid, over the whole clip')
    ap.add_argument('--times', default='', help='comma-separated ms')
    ap.add_argument('--split', type=int, default=None, help='split ms; finds the two halves at once')
    ap.add_argument('--one', action='store_true', help='one process, no split')
    ap.add_argument('--pass1', action='store_true', help="the live server's pass 1 (worker/main.py)")
    ap.add_argument('--windows', default=None, help="JSON zoom windows: the live server's pass 2, with --split")
    ap.add_argument('--after', default=None, help="first run pass 1 on this clip in the same processes, as a warm worker has")
    a = ap.parse_args()

    if a.pass1 or a.windows is not None:
        info = poses.clip_info(a.clip)
        poses.pool()
        if a.after:
            poses.first_pass(a.after, poses.clip_info(a.after).duration)
        t0 = time.monotonic()
        frames = poses.first_pass(a.clip, info.duration) if a.pass1 else poses.second_pass(a.clip, info.duration, json.loads(a.windows), a.split)
        json.dump({'w': info.w, 'h': info.h, 'duration': info.duration, 'fps': None,
                   'secs': round(time.monotonic() - t0, 3), 'frames': frames}, sys.stdout)
        return

    info = poses.clip_info(a.clip)
    times = poses.grid(info.duration, a.fps) if a.fps else [int(x) for x in a.times.split(',') if x]
    t0 = time.monotonic()
    if a.one:
        poses.warm()
        t0 = time.monotonic()
        frames = poses.find_at(a.clip, times)
    else:
        poses.pool()
        t0 = time.monotonic()
        frames = poses.find_split(a.clip, times, a.split)
    secs = time.monotonic() - t0
    json.dump({'w': info.w, 'h': info.h, 'duration': info.duration, 'fps': a.fps or None,
               'secs': round(secs, 3), 'frames': frames}, sys.stdout)


if __name__ == '__main__':
    main()
