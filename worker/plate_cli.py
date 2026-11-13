"""The server's plate tracker from the command line, for tests/worker/plate.test.ts.

  python worker/plate_cli.py grey clip.mp4 out_dir   # the 15 fps grey frames: out_dir/grey.bin + grey.json
  python worker/plate_cli.py track grey_dir x y size # the plate's path on those frames, as JSON
  python worker/plate_cli.py clip clip.mp4 x y size  # the path straight from the clip, as the worker runs it
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402

import plate  # noqa: E402
import poses  # noqa: E402


def frames_from(d: Path):
    meta = json.loads((d / 'grey.json').read_text())
    buf = np.fromfile(d / 'grey.bin', dtype=np.uint8)
    w, h = meta['w'], meta['h']
    for i, t in enumerate(meta['times']):
        yield t, buf[i * w * h:(i + 1) * w * h].reshape(h, w)


def main() -> None:
    cmd, *a = sys.argv[1:]
    if cmd == 'grey':
        clip, out = a[0], Path(a[1])
        out.mkdir(parents=True, exist_ok=True)
        info = poses.clip_info(clip)
        times, w, h = [], 0, 0
        with open(out / 'grey.bin', 'wb') as f:
            for t, g in plate.grey_frames(clip, poses.grid(info.duration, plate.FPS)):
                times.append(t)
                h, w = g.shape
                f.write(g.tobytes())
        (out / 'grey.json').write_text(json.dumps({'w': w, 'h': h, 'times': times}))
        print(json.dumps({'w': w, 'h': h, 'frames': len(times)}))
    elif cmd == 'track':
        tap = {'x': float(a[1]), 'y': float(a[2]), 'size': float(a[3])}
        json.dump(plate.track_frames(frames_from(Path(a[0])), tap), sys.stdout)
    elif cmd == 'clip':
        info = poses.clip_info(a[0])
        tap = {'x': float(a[1]), 'y': float(a[2]), 'size': float(a[3])}
        json.dump(plate.track_clip(a[0], tap, info.duration), sys.stdout)
    else:
        raise SystemExit(f'unknown command {cmd}')


if __name__ == '__main__':
    main()
