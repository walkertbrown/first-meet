"""The server's plate track of every bench clip (plan 3.4d step 11, item 108): `data/server/<id>.json`.

Each is what the worker's `one_bar` posts: `plate.track_clip` on the server's 15 fps frames, from the trace's own tap
(`data/traces/<id>.json`, its `mark`), [t ms, x, y, score] a frame in the clip's own time. The referee bot's set
(tests/referee-bot/build-set.ts) saves these as each bench's path, through takeBar's stuck guard (`markStuck`),
as the product does. `data/traces/` (the phone's) stays for the commands test only.

Needs the worker's Python (MediaPipe's env, for ffmpeg and numpy) and the clips, which aren't committed:

    python tests/bench-commands/server.py --clips <folder with meet/<clip>.mp4 and bench/<id>.webm> [--only IA0P...]
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
sys.path.insert(0, os.path.join(ROOT, 'worker'))
DATA = os.path.join(HERE, 'data')


def clips() -> dict[str, str]:
    """Trace id -> its clip, as build-set.ts names them."""
    out = {}
    with open(os.path.join(DATA, 'calls-meet.json')) as f:
        for m in json.load(f)['attempts']:
            out[m['id']] = f"meet/{m['clip'].split(' ')[0]}.mp4"
    with open(os.path.join(DATA, 'calls-run1.json')) as f:
        for g in json.load(f)['attempts']:
            out[g['id']] = f"bench/{g['id']}.webm"
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--clips', required=True)
    ap.add_argument('--only', nargs='*')
    a = ap.parse_args()
    import plate
    import poses
    os.makedirs(os.path.join(DATA, 'server'), exist_ok=True)
    for tid, clip in sorted(clips().items()):
        if a.only and tid not in a.only:
            continue
        with open(os.path.join(DATA, 'traces', f'{tid}.json')) as f:
            m = json.load(f)['mark']
        v = os.path.join(a.clips, clip)
        tap = {'x': m['x'], 'y': m['y'], **({'size': m['size']} if m.get('size') else {})}
        pts = plate.track_clip(v, tap, poses.clip_info(v).duration, round(m['t'] * 1000))
        with open(os.path.join(DATA, 'server', f'{tid}.json'), 'w') as f:
            json.dump(pts, f, separators=(',', ':'))
        print(tid, len(pts))


if __name__ == '__main__':
    main()
