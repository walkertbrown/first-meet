"""Puts the GL dispatch libraries MediaPipe links into worker/.gl/ (Render build step).

MediaPipe's Python library links libEGL.so.1 and libGLESv2.so.2 even when it runs on the
CPU, and Render's native Python runtime has neither (no apt there). These are libglvnd's
small dispatch libraries from Debian 11, pinned by SHA-256 to Debian's package index;
poses.py loads them before MediaPipe when worker/.gl/ exists. Nothing in them runs GL:
with no vendor library they only satisfy the link.

Build: pip install -r worker/requirements.txt && python worker/vendor_gl.py
"""
from __future__ import annotations

import hashlib
import io
import sys
import tarfile
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent / '.gl'
POOL = 'https://deb.debian.org/debian/pool/main/libg/libglvnd/'
DEBS = {
    'libglvnd0_1.3.2-1_amd64.deb': '52a4464d181949f5ed8f7e55cca67ba2739f019e93fcfa9d14e8d65efe98fffc',
    'libegl1_1.3.2-1_amd64.deb': '3a5583ebd7a9d8ad102484db9637c409561428d21345037b310c4ef2ca8e8837',
    'libgles2_1.3.2-1_amd64.deb': '367116f5e3b3a003a80203848b5ce1401451a67c2b2b9d6a383efc91badb0724',
}
# The order poses.py loads them in: each needs the ones before it.
LIBS = ['libGLdispatch.so.0', 'libEGL.so.1', 'libGLESv2.so.2']


def ar_members(data: bytes) -> dict[str, bytes]:
    """The files in a .deb (an `ar` archive)."""
    if not data.startswith(b'!<arch>\n'):
        raise ValueError('not a .deb')
    out, i = {}, 8
    while i + 60 <= len(data):
        head = data[i:i + 60]
        name = head[:16].decode().strip().rstrip('/')
        size = int(head[48:58].decode().strip())
        out[name] = data[i + 60:i + 60 + size]
        i += 60 + size + (size & 1)
    return out


def extract(deb: bytes, want: set[str]) -> dict[str, bytes]:
    """The shared libraries named in `want`, from a .deb's data.tar.xz (symlinks followed)."""
    members = ar_members(deb)
    data = next(v for k, v in members.items() if k.startswith('data.tar'))
    got: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(data)) as t:
        by_name = {Path(m.name).name: m for m in t.getmembers()}
        for name in want & by_name.keys():
            m = by_name[name]
            while m.issym():
                m = by_name[Path(m.linkname).name]
            f = t.extractfile(m)
            if f:
                got[name] = f.read()
    return got


def fetch(name: str, local: Path | None) -> bytes:
    data = (local / name).read_bytes() if local else urllib.request.urlopen(POOL + name, timeout=60).read()
    if hashlib.sha256(data).hexdigest() != DEBS[name]:
        raise SystemExit(f'{name}: SHA-256 does not match Debian\'s index')
    return data


def main(local: Path | None = None) -> None:
    OUT.mkdir(exist_ok=True)
    found: dict[str, bytes] = {}
    for name in DEBS:
        found.update(extract(fetch(name, local), set(LIBS)))
    missing = [lib for lib in LIBS if lib not in found]
    if missing:
        raise SystemExit(f'missing from the packages: {missing}')
    for lib in LIBS:
        (OUT / lib).write_bytes(found[lib])
    print('vendored', ', '.join(LIBS), 'into', OUT)


if __name__ == '__main__':
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else None)
