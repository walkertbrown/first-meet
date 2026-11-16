"""The referee bot test's frames (plan 3.4d step 11): each attempt cut as the bot would get it.

Reads a set file (calls.json) and, for each attempt, runs the worker's own frame code,
`referee_frames.make_frames`, on the attempt's stretch of its clip. So the frames here are
exactly the ones the product sends: the same picks, stamps, size and JPEG quality, and on the
bench the same poses. Writes frames.json: for each attempt the frame times and each JPEG's
SHA-256, so any later run can show it used the same frames, and on the bench how its touch was found
(`bench_path.bench_way`: the way, the touch and lockout in ms). Every attempt's JPEGs are written,
since run.ts reads them all, but only those of clips the repo may hold (`free: true`) are
committed (5.2); the rest are made again from the clip by whoever reruns this.

Each attempt in the set file:
  {"id": "...", "clip": "<path, from the repo root or the clips folder>", "free": true|false,
   "window_ms": [w0, w1] | null, "commands": [[ms, "Press!"], ...],
   "moments": [{"ms": ..., "flagged": true|false}], "bench": {"start_ms", "press_ms" | null, "rack_ms", "path"?: [[ms, y, score], ...]} | null}
Every time is from the window's start, as if the phone had filmed only that stretch.

Usage (MediaPipe needs a CPU list in /sys; see README.md):
  python3 tests/referee-bot/recut.py calls.json --clips DIR --out DIR [--only ID ...]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'worker'))

import referee_frames as rf  # noqa: E402


def clip_path(clip: str, clips_dir: str | None) -> str:
    for base in ([clips_dir] if clips_dir else []) + [ROOT]:
        p = os.path.join(base, clip)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(clip)


def cut(a: dict, clips_dir: str | None) -> tuple[list[tuple[int, bytes]], bool | None]:
    commands = [(int(t), str(w)) for t, w in a.get('commands') or []]
    window = tuple(a['window_ms']) if a.get('window_ms') else None
    return rf.make_frames(clip_path(a['clip'], clips_dir), commands, a.get('moments') or [], a.get('bench'), window=window)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('set')
    ap.add_argument('--clips', help='folder holding the clips the repo does not')
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', nargs='*')
    o = ap.parse_args(argv)
    with open(o.set, 'rb') as f:
        raw = f.read()
    attempts = json.loads(raw)['attempts']
    os.makedirs(o.out, exist_ok=True)
    out_json = os.path.join(o.out, 'frames.json')
    done = json.load(open(out_json)) if os.path.exists(out_json) else {}
    if done.get('set_sha256') not in (None, hashlib.sha256(raw).hexdigest()):
        done = {}
    done['set_sha256'] = hashlib.sha256(raw).hexdigest()
    rows = done.setdefault('attempts', {})
    for a in attempts:
        if o.only and a['id'] not in o.only:
            continue
        frames, how = cut(a, o.clips)
        rows[a['id']] = {
            'bench': how,
            'frames': [{'n': n, 't_ms': t, 'sha256': hashlib.sha256(j).hexdigest()} for n, (t, j) in enumerate(frames)],
        }
        d = os.path.join(o.out, 'jpeg', a['id'])
        os.makedirs(d, exist_ok=True)
        for n, (_, j) in enumerate(frames):
            with open(os.path.join(d, f'{n:02d}.jpg'), 'wb') as f:
                f.write(j)
        print(f"{a['id']}: {len(frames)} frames" + ('' if how is None else f", touch from {how['way']}"), flush=True)
        with open(out_json, 'w') as f:
            json.dump(done, f, indent=1, sort_keys=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
