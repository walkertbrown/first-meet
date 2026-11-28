"""Her lift clip (plan 3.9 step 6, piece 7, look 9 "Lift clip"): one 9:16 MP4, 15 s or less.

  1. Her attempt (the web service picks the part: the lift, or her last 3 reps on a Home white,
     or the missed rep and the 2 before it on a red).
  2. The three lamps lighting in real timing (330 ms apart), with thocks.
  3. A 2 s hold on the judged frame with the judge's marks.
  4. The story card fades in over 400 ms and holds for 3 s. A bomb-out's clip ends on her best lift's end frame
     in its place (item 101); the job's card_path says which.

Beside the clip, its poster (look 9 "The bomb-out clip"): the first frame of the 2 s hold, a 432 x 768 JPEG.

Portrait footage fills the frame uncropped, with the lamps at the stage's scale, as the phone's
"Save my clip" draws them (web/lib/stage/clip-maker.ts). Landscape footage (the presses) is laid out
on the stage with no crop and no bars (look 9, "Landscape footage"): the lamps at y = 220, the footage
1080 x 608 at y = 560, the lift line and the weight under it, and the footer.

1080 x 1920 at 30 fps, H.264 and AAC. The only sound is the thocks (her uploads have no sound).
The bundled ffmpeg (imageio-ffmpeg) decodes and encodes; Pillow draws.
"""
from __future__ import annotations

import io
import math
import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1080, 1920, 30
RATE = 48_000
FONTS = Path(__file__).resolve().parent.parent / 'web' / 'card-fonts'

STAGE = (13, 14, 19)          # --stage #0D0E13
INK = (241, 239, 232)         # --stage-ink #F1EFE8
INK2 = (166, 169, 179)        # --stage-ink-2 #A6A9B3
OFF = (25, 27, 34)            # an unlit lamp #191B22
BEZEL = (44, 47, 57)          # #2C2F39
LAMP = {
    'white': {'glow': (255, 230, 175), 'stops': [(0, (255, 255, 255)), (.36, (255, 255, 255)), (.6, (255, 244, 216)), (1, (242, 223, 178))]},
    'red': {'glow': (240, 48, 42), 'stops': [(0, (255, 178, 164)), (.24, (255, 178, 164)), (.6, (240, 48, 42)), (1, (181, 22, 15))]},
}
FOOTER = 'Hosted by Love Soo · @lovesoostrong'

# the stage's scale in portrait: the phone's stage is 390 px wide
S = W / 390


@dataclass(frozen=True)
class Times:
    lamps_ms: int = 330 * 3 + 420
    lamp_gap_ms: int = 330
    hold_ms: int = 2000
    fade_ms: int = 400
    card_ms: int = 3000

    @classmethod
    def of(cls, d: dict | None) -> 'Times':
        d = d or {}
        return cls(**{k: int(d[k]) for k in ('lamps_ms', 'lamp_gap_ms', 'hold_ms', 'fade_ms', 'card_ms') if k in d})


def frames_for(ms: float) -> int:
    return max(0, round(ms * FPS / 1000))


@dataclass(frozen=True)
class Layout:
    """Where things sit in the 1080 x 1920 frame."""
    landscape: bool
    box: tuple[int, int, int, int]      # the footage's area: x, y, w, h (the picture is centred in it)
    lamp_r: float
    lamp_gap: float
    lamp_cy: float


def layout(src_w: int, src_h: int) -> Layout:
    if src_w > src_h:
        # look 9: lamps 120 px, 36 px apart, tops at y = 220; footage 1080 x 608 at y = 560
        return Layout(True, (0, 560, W, 608), 60, 36, 220 + 60)
    r = 34 * S
    return Layout(False, (0, 0, W, H), r, 24 * S, 108 * S + r)


def fit(src_w: int, src_h: int, box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """The picture inside the box, uncropped and centred: x, y, w, h (even sizes for the scaler)."""
    bx, by, bw, bh = box
    k = min(bw / src_w, bh / src_h)
    w, h = int(src_w * k) // 2 * 2, int(src_h * k) // 2 * 2
    return bx + (bw - w) // 2, by + (bh - h) // 2, w, h


# ---------- sound ----------

def thock(red: bool) -> np.ndarray:
    """web/lib/stage/thock.ts: a sine from 190 to 95 Hz (red 150 to 70) over 140 ms, gain up to .35 in
    8 ms and gone by 220 ms, both exponential."""
    n = int(RATE * 0.25)
    t = np.arange(n) / RATE
    f0, f1 = (150.0, 70.0) if red else (190.0, 95.0)
    f = np.where(t < 0.14, f0 * (f1 / f0) ** (t / 0.14), f1)
    phase = 2 * np.pi * np.cumsum(f) / RATE
    lo, hi = 0.0001, 0.35
    g = np.where(t < 0.008, lo * (hi / lo) ** (t / 0.008), hi * (lo / hi) ** ((t - 0.008) / (0.22 - 0.008)))
    g = np.where(t > 0.22, 0.0, g)
    return (np.sin(phase) * g).astype(np.float32)


def soundtrack(total_ms: float, lamps_at_ms: float, lamps: list[str], gap_ms: int) -> np.ndarray:
    """Silence with a thock as each lamp lights."""
    out = np.zeros(int(RATE * total_ms / 1000) + 1, dtype=np.float32)
    for i, colour in enumerate(lamps):
        at = int(RATE * (lamps_at_ms + i * gap_ms) / 1000)
        s = thock(colour == 'red')[: max(0, len(out) - at)]
        out[at: at + len(s)] += s
    return out


def write_wav(path: str, samples: np.ndarray) -> None:
    pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


# ---------- drawing ----------

def _font(name: str, size: float) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), round(size))


def _lamp_sprite(state: str, r: float, glow_px: float) -> Image.Image:
    """One lamp with its bezel and, lit, its glow: an RGBA square centred on the lamp."""
    pad = int(glow_px * 1.6 + 5 * S)
    size = int(2 * r) + 2 * pad
    c = size / 2
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if state in LAMP:
        glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        g = r + glow_px * 0.35
        ImageDraw.Draw(glow).ellipse([c - g, c - g, c + g, c + g], fill=(*LAMP[state]['glow'], 153))
        im = Image.alpha_composite(im, glow.filter(ImageFilter.GaussianBlur(glow_px / 2.5)))
    d = ImageDraw.Draw(im)
    bz = r + 5 * S * (r / (34 * S))
    d.ellipse([c - bz, c - bz, c + bz, c + bz], fill=(*BEZEL, 255))
    if state in LAMP:
        # the radial gradient, its centre a little up and left (clip-maker.ts)
        yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
        cx, cy = c - r * 0.08, c - r * 0.16
        dist = np.clip(np.hypot(xx - cx, yy - cy) / r, 0, 1)
        stops = LAMP[state]['stops']
        pos = [p for p, _ in stops]
        rgb = np.stack([np.interp(dist, pos, [col[k] for _, col in stops]) for k in range(3)], axis=-1)
        inside = np.hypot(xx - c, yy - c) <= r
        alpha = np.where(inside, 255, 0)
        grad = Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), 'RGBA')
        im = Image.alpha_composite(im, grad)
    else:
        d.ellipse([c - r, c - r, c + r, c + r], fill=(*OFF, 255))
    return im


class Painter:
    """Draws every frame of one clip."""

    def __init__(self, lay: Layout, pic: tuple[int, int, int, int], job: dict, card: Image.Image):
        self.lay, self.pic, self.job = lay, pic, job
        glow = 60 * S * (lay.lamp_r / (34 * S))
        self.sprites = {s: _lamp_sprite(s, lay.lamp_r, glow) for s in ('off', 'white', 'red')}
        self.card = card.convert('RGB').resize((W, H), Image.LANCZOS) if card.size != (W, H) else card.convert('RGB')
        self.base = Image.new('RGB', (W, H), STAGE)
        if lay.landscape:
            d = ImageDraw.Draw(self.base)
            hud = _font('anybody-800-112.ttf', 40)
            tracked(d, (W / 2, 1220), job.get('lift_line', ''), hud, INK2, 0.04 * 40)
            d.text((W / 2, 1220 + 40 * 1.25 + 12), job.get('weight', ''), font=_font('anybody-900-120.ttf', 112), fill=INK, anchor='mt')
            d.text((W / 2, H - 96), FOOTER, font=_font('atkinson-400.ttf', 28), fill=INK2, anchor='md')

    def lamps(self, im: Image.Image, states: list[str]) -> None:
        lay = self.lay
        for i, st in enumerate(states):
            cx = W / 2 + (i - 1) * (2 * lay.lamp_r + lay.lamp_gap)
            sp = self.sprites[st]
            im.paste(sp, (round(cx - sp.width / 2), round(lay.lamp_cy - sp.height / 2)), sp)

    def marks(self, im: Image.Image) -> None:
        m = self.job.get('marks')
        if not m or not m.get('pts'):
            return
        x0, y0, w, h = self.pic
        mirror = bool(self.job.get('mirror'))
        k = (w / 390) if self.lay.landscape else S   # the stage's mark sizes, at this picture's scale
        pts = [((x0 + (1 - px) * w) if mirror else (x0 + px * w), y0 + py * h) for px, py in m['pts']]
        colour = _hex(m.get('colour', '#A6A9B3'))
        d = ImageDraw.Draw(im)
        dash, gap, lw = 6 * k, 5 * k, max(2, round(2.5 * k))
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            seg = math.hypot(bx - ax, by - ay)
            t = 0.0
            while t < seg:
                e = min(seg, t + dash)
                d.line([(ax + (bx - ax) * t / seg, ay + (by - ay) * t / seg), (ax + (bx - ax) * e / seg, ay + (by - ay) * e / seg)], fill=colour, width=lw)
                t += dash + gap
        r = 6 * k
        for px, py in pts:
            d.ellipse([px - r, py - r, px + r, py + r], fill=colour)

    def frame(self, picture: Image.Image | None, lamps: list[str] | None, dim: float = 0.0, marks: bool = False) -> Image.Image:
        im = self.base.copy()
        if picture is not None:
            im.paste(picture, self.pic[:2])
        if dim and not self.lay.landscape:
            im = Image.blend(im, Image.new('RGB', (W, H), (5, 6, 10)), dim)
        if marks:
            self.marks(im)
        if lamps is not None:
            self.lamps(im, lamps)
        return im


def tracked(d: ImageDraw.ImageDraw, at: tuple[float, float], text: str, font: ImageFont.FreeTypeFont, fill, spacing: float) -> None:
    """Centred text with letter-spacing (HUD label type is +0.04em), every letter on one baseline.

    `at[1]` is the top of the capitals. Each letter is drawn at the baseline ('ls'), not at its own top ('lt'): a
    middle dot's top is the whole dot, so 'lt' raised it to cap height (LookieBot at e0e2353, `DEADLIFT ˙ 3 OF 3`).
    """
    widths = [font.getlength(ch) for ch in text]
    x = at[0] - (sum(widths) + spacing * max(0, len(text) - 1)) / 2
    baseline = at[1] - font.getbbox('H', anchor='ls')[1]
    for ch, w in zip(text, widths):
        d.text((x, baseline), ch, font=font, fill=fill, anchor='ls')
        x += w + spacing


def _hex(s: str) -> tuple[int, int, int]:
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


# ---------- decoding and encoding ----------

def ffmpeg_exe() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def probe(path: str) -> tuple[int, int, float]:
    """Width and height as shown (turned upright), and length in seconds."""
    import imageio_ffmpeg
    gen = imageio_ffmpeg.read_frames(path)
    meta = next(gen)
    gen.close()
    w, h = meta['size']
    if int(meta.get('rotate') or 0) % 180 == 90:
        w, h = h, w
    return w, h, float(meta.get('duration') or 0)


def footage(path: str, start_ms: int, end_ms: int, size: tuple[int, int], mirror: bool):
    """Her attempt from start to end at 30 fps, scaled to `size`, mirrored if her stage was."""
    import imageio_ffmpeg
    vf = f'scale={size[0]}:{size[1]}:flags=bicubic' + (',hflip' if mirror else '') + f',fps={FPS}'
    gen = imageio_ffmpeg.read_frames(path, pix_fmt='rgb24', input_params=['-ss', f'{start_ms / 1000:.3f}'],
                                     output_params=['-t', f'{(end_ms - start_ms) / 1000:.3f}', '-vf', vf])
    try:
        meta = next(gen)
        w, h = meta['size']
        for raw in gen:
            yield Image.frombuffer('RGB', (w, h), raw, 'raw', 'RGB', 0, 1)
    finally:
        gen.close()


def still(path: str, at_ms: int, size: tuple[int, int], mirror: bool) -> Image.Image | None:
    """The judged frame."""
    vf = f'scale={size[0]}:{size[1]}:flags=bicubic' + (',hflip' if mirror else '')
    out = subprocess.run([ffmpeg_exe(), '-v', 'error', '-ss', f'{at_ms / 1000:.3f}', '-i', path, '-frames:v', '1', '-vf', vf,
                          '-f', 'image2pipe', '-c:v', 'png', '-'], capture_output=True, timeout=60)
    if out.returncode != 0 or not out.stdout:
        return None
    return Image.open(io.BytesIO(out.stdout)).convert('RGB')


POSTER = (432, 768)


def write_poster(hold: Image.Image, path: str) -> None:
    """The first frame of the hold, at twice the page's 216 x 384 thumbnail."""
    hold.convert('RGB').resize(POSTER, Image.LANCZOS).save(path, 'JPEG', quality=85, optimize=True, progressive=True)


def render(job: dict, video_path: str, card: Image.Image, out_path: str, work_dir: str, poster_path: str | None = None) -> dict:
    """Makes the clip at out_path, and its poster at poster_path. Returns its length and frame count."""
    times = Times.of(job.get('times'))
    src_w, src_h, _ = probe(video_path)
    lay = layout(src_w, src_h)
    pic = fit(src_w, src_h, lay.box)
    size = (pic[2], pic[3])
    mirror = bool(job.get('mirror'))
    p = Painter(lay, pic, job, card)
    lamps = [s if s in LAMP else 'white' for s in (job.get('lamps') or ['white'] * 3)][:3]
    off = ['off'] * 3 if lay.landscape else None

    counts = {'footage': 0}

    def all_frames():
        last = None
        for f in footage(video_path, int(job['start_ms']), int(job['end_ms']), size, mirror):
            counts['footage'] += 1
            last = f
            yield p.frame(f, off).tobytes()
        held = still(video_path, int(job['judged_ms']), size, mirror) or last
        for k in range(frames_for(times.lamps_ms)):
            t = k * 1000 / FPS
            yield p.frame(held, [s if t >= i * times.lamp_gap_ms else 'off' for i, s in enumerate(lamps)], dim=0.18).tobytes()
        hold = p.frame(held, lamps, dim=0.18, marks=True)
        if poster_path:
            write_poster(hold, poster_path)
        hb = hold.tobytes()
        for _ in range(frames_for(times.hold_ms)):
            yield hb
        n = frames_for(times.fade_ms)
        for k in range(n):
            yield Image.blend(hold, p.card, (k + 1) / n).tobytes()
        cb = p.card.tobytes()
        for _ in range(frames_for(times.card_ms)):
            yield cb

    # the frames stream into the encoder; the sound needs the footage's length, so it's made first
    footage_ms = int(job['end_ms']) - int(job['start_ms'])
    total_ms = footage_ms + times.lamps_ms + times.hold_ms + times.fade_ms + times.card_ms
    wav = str(Path(work_dir) / 'thocks.wav')
    write_wav(wav, soundtrack(total_ms, footage_ms, lamps, times.lamp_gap_ms))

    cmd = [ffmpeg_exe(), '-y', '-v', 'error',
           '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-i', wav,
           '-map', '0:v', '-map', '1:a',
           '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
           '-c:a', 'aac', '-b:a', '128k', '-ar', str(RATE),
           '-shortest', '-movflags', '+faststart', out_path]
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    n = 0
    try:
        for b in all_frames():
            enc.stdin.write(b)  # type: ignore[union-attr]
            n += 1
    finally:
        enc.stdin.close()  # type: ignore[union-attr]
        err = enc.stderr.read().decode(errors='replace')  # type: ignore[union-attr]
        enc.wait(timeout=120)
    if enc.returncode != 0:
        raise RuntimeError(f'encode failed: {err[-300:]}')
    if counts['footage'] == 0:
        raise RuntimeError('no footage between start and end')
    return {'frames': n, 'footage_frames': counts['footage'], 'seconds': round(n / FPS, 2), 'landscape': lay.landscape}
