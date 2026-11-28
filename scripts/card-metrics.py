"""Write web/lib/card/card-metrics.ts: advance widths (2000 units to the em) of the card's name and body faces.

The Post card (look 9) lays the name and meta beside the lamps, and the total takes the height left under them. Satori
can't say how many lines a name wraps to before it draws, so the card counts them from these widths (LookieBot at
e0e2353: a wrapped name ran into the total).

usage: python3 -I scripts/card-metrics.py   (Pillow; reads web/card-fonts/)
"""
import json
import os
import sys

from PIL import ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FACES = {'name': 'anybody-800-104.ttf', 'body': 'atkinson-400.ttf'}
CHARS = [chr(c) for c in range(32, 127)] + [chr(c) for c in range(160, 384)] + list('‘’“”–—…·')
EM = 2000


def table(path):
    f = ImageFont.truetype(path, EM)
    out = {}
    for ch in CHARS:
        try:
            w = f.getlength(ch)
        except Exception:
            continue
        if w > 0 or ch == ' ':
            out[ch] = round(w)
    return out


def main():
    tables = {k: table(os.path.join(ROOT, 'web', 'card-fonts', v)) for k, v in FACES.items()}
    lines = [
        '// Written by scripts/card-metrics.py: advance widths, 2000 units to the em, of the Post card\'s name and body',
        '// faces (web/card-fonts). Characters not listed count as the widest in their table.',
    ]
    for k, t in tables.items():
        lines.append(f'export const {k.upper()}_ADVANCE: Record<string, number> = {json.dumps(t, ensure_ascii=False, separators=(",", ":"))};')
    with open(os.path.join(ROOT, 'web', 'lib', 'card', 'card-metrics.ts'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')
    print({k: len(t) for k, t in tables.items()}, file=sys.stderr)


if __name__ == '__main__':
    main()
