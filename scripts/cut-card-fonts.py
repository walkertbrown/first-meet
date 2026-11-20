"""Cut the static TTF instances the card images use (look 9, "The card images"; Buildnanafest's item 42).

Satori reads neither variable fonts nor woff2, so each weight and width the cards use is cut from the site's own
variable woff2 files with fontTools' instancer, latin and latin-ext merged into one file, and written to
web/card-fonts/. The referee bot's frames (plan 3.4d step 1) use atkinson-700 from the same folder, drawn with Pillow.

usage: PYTHONPATH=<fonttools+brotli> python3 scripts/cut-card-fonts.py
"""
import io
import os
import sys

from fontTools.merge import Merger
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'web', 'public', 'fonts')
OUT = os.path.join(ROOT, 'web', 'card-fonts')

# (file name, source family, axes)
CUTS = [
    ('anybody-900-130', 'anybody-normal', {'wght': 900, 'wdth': 130}),  # the total
    ('anybody-900-120', 'anybody-normal', {'wght': 900, 'wdth': 120}),  # the weight on landscape clips
    ('anybody-800-112', 'anybody-normal', {'wght': 800, 'wdth': 112}),  # the wordmark
    ('anybody-800-104', 'anybody-normal', {'wght': 800, 'wdth': 104}),  # the name and the lift numbers
    ('anybody-800-88', 'anybody-normal', {'wght': 800, 'wdth': 88}),    # 9 FOR 9 and HUD labels
    ('anybody-700-100', 'anybody-normal', {'wght': 700, 'wdth': 100}),  # LB TOTAL / LB LIFTED
    ('anybody-700-88', 'anybody-normal', {'wght': 700, 'wdth': 88}),    # eyebrows
    ('atkinson-400', 'atkinson-hyperlegible-next-normal', {'wght': 400}),  # body and footer
    ('atkinson-400-italic', 'atkinson-hyperlegible-next-italic', {'wght': 400}),  # the certificate's quote
    ('atkinson-700', 'atkinson-hyperlegible-next-normal', {'wght': 700}),  # the referee bot's frame stamps
]


def cut(family: str, axes: dict, subset: str) -> bytes:
    f = TTFont(os.path.join(SRC, f'{family}-{subset}.woff2'))
    inst = instancer.instantiateVariableFont(f, axes, updateFontNames=False)
    inst.flavor = None
    buf = io.BytesIO()
    inst.save(buf)
    return buf.getvalue()


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    for name, family, axes in CUTS:
        parts = []
        for subset in ('latin', 'latin-ext'):
            p = os.path.join(OUT, f'.{name}-{subset}.ttf')
            with open(p, 'wb') as fh:
                fh.write(cut(family, axes, subset))
            parts.append(p)
        merged = Merger().merge(parts)
        merged.save(os.path.join(OUT, f'{name}.ttf'))
        for p in parts:
            os.remove(p)
        print(name, os.path.getsize(os.path.join(OUT, f'{name}.ttf')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
