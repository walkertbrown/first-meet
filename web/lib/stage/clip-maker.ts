// "Save my clip" (plan 5.2): a 9:16 video made on the phone. Her squat, then the lamps
// one by one, then a 2 s hold on the judged frame with the judge's marks. A Small line
// under the lamps reads "First Meet · Try a lift". Nothing is uploaded.
import type { LampState } from '@/components/lamps';
import type { Marks } from './snap';
import { recorderMime, readyToSeek, seekTo } from './recorder';

export const CLIP_W = 720;
export const CLIP_H = 1280;
export const CLIP_LINE = 'First Meet · Try a lift';

export type ClipInput = {
  /** Her recording, from "Squat!" to "Rack!". */
  video: Blob;
  /** The judged frame, at the camera's size. */
  judged: HTMLCanvasElement;
  marks: Marks | null;
  lamps: LampState[];
  markColour: string;
  /** The front camera's picture is shown mirrored on the stage, so the clip is too. */
  mirror: boolean;
};

const C = {
  stage: '#0D0E13', ink: '#F1EFE8', ink2: '#A6A9B3', off: '#191B22', bezel: '#2C2F39',
  white: '#FFF4D8', whiteGlow: '255 230 175', red: '#F0302A', redGlow: '240 48 42',
};

function cssColour(c: string) {
  if (c.includes('lamp-white')) return C.white;
  if (c.includes('lamp-red')) return C.red;
  if (c.includes('stage-ink-2')) return C.ink2;
  return c;
}

/** Where a w×h picture sits inside the clip, uncropped (object-fit: contain). */
function contain(w: number, h: number) {
  const k = Math.min(CLIP_W / w, CLIP_H / h);
  const dw = w * k, dh = h * k;
  return { x: (CLIP_W - dw) / 2, y: (CLIP_H - dh) / 2, w: dw, h: dh, k };
}

function drawPicture(g: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number, mirror: boolean) {
  const b = contain(w, h);
  g.save();
  if (mirror) { g.translate(CLIP_W, 0); g.scale(-1, 1); }
  g.drawImage(src, b.x, b.y, b.w, b.h);
  g.restore();
  return b;
}

/** The three lamps at the stage's scale (68 px lamps at 390 px wide). */
function drawLamps(g: CanvasRenderingContext2D, lamps: LampState[]) {
  const s = CLIP_W / 390, r = 34 * s, gap = 24 * s, cy = 108 * s + r;
  lamps.forEach((st, i) => {
    const cx = CLIP_W / 2 + (i - 1) * (2 * r + gap);
    g.save();
    g.beginPath(); g.arc(cx, cy, r + 5 * s, 0, Math.PI * 2); g.fillStyle = C.bezel; g.fill();
    if (st === 'white' || st === 'red') {
      const glow = st === 'white' ? C.whiteGlow : C.redGlow;
      g.shadowColor = `rgb(${glow} / .6)`; g.shadowBlur = 60 * s;
      const grad = g.createRadialGradient(cx - r * 0.08, cy - r * 0.16, 0, cx, cy, r);
      if (st === 'white') { grad.addColorStop(0, '#FFFFFF'); grad.addColorStop(0.36, '#FFFFFF'); grad.addColorStop(0.6, C.white); grad.addColorStop(1, '#F2DFB2'); }
      else { grad.addColorStop(0, '#FFB2A4'); grad.addColorStop(0.24, '#FFB2A4'); grad.addColorStop(0.6, C.red); grad.addColorStop(1, '#B5160F'); }
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = grad; g.fill();
    } else {
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = C.off; g.fill();
    }
    g.restore();
  });
  g.save();
  g.font = `400 ${15 * s}px "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", Verdana, sans-serif`;
  g.fillStyle = C.ink2; g.textAlign = 'center'; g.textBaseline = 'top';
  g.fillText(CLIP_LINE, CLIP_W / 2, cy + r + 24 * s);
  g.restore();
}

function drawMarks(g: CanvasRenderingContext2D, m: Marks, b: ReturnType<typeof contain>, mirror: boolean, colour: string) {
  const s = CLIP_W / 390;
  const at = (p: { x: number; y: number }) => {
    const x = b.x + p.x * b.k;
    return { x: mirror ? CLIP_W - x : x, y: b.y + p.y * b.k };
  };
  const hip = at(m.hip), knee = at(m.knee), c = cssColour(colour);
  g.save();
  g.strokeStyle = c; g.fillStyle = c; g.lineCap = 'butt';
  g.lineWidth = 2.5 * s; g.setLineDash([6 * s, 5 * s]);
  g.beginPath(); g.moveTo(hip.x, hip.y); g.lineTo(knee.x, knee.y); g.stroke();
  g.setLineDash([]); g.globalAlpha = 0.45; g.lineWidth = 1.5 * s;
  const dir = knee.x >= hip.x ? 1 : -1;
  g.beginPath(); g.moveTo(knee.x - dir * 70 * s, knee.y); g.lineTo(knee.x + dir * 20 * s, knee.y); g.stroke();
  g.globalAlpha = 1;
  for (const p of [hip, knee]) { g.beginPath(); g.arc(p.x, p.y, 6 * s, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

/** Makes the clip in real time (her squat's length plus about 3 s). */
export async function makeClip(input: ClipInput): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = CLIP_W; canvas.height = CLIP_H;
  const g = canvas.getContext('2d')!;
  const mimeType = recorderMime('mp4');
  if (!mimeType || !('captureStream' in canvas)) throw new Error('This browser can’t make video');
  await document.fonts?.ready;

  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(v);
  const url = URL.createObjectURL(input.video);
  v.src = url;

  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>(r => { rec.onstop = () => r(); });

  const bg = () => { g.fillStyle = C.stage; g.fillRect(0, 0, CLIP_W, CLIP_H); };
  try {
    await readyToSeek(v);
    await seekTo(v, 0);
    bg();
    drawPicture(g, v, v.videoWidth, v.videoHeight, input.mirror);
    rec.start(250);

    // 1. Her squat.
    await v.play();
    await new Promise<void>(resolve => {
      const tick = () => {
        bg();
        drawPicture(g, v, v.videoWidth, v.videoHeight, input.mirror);
        if (v.ended || v.currentTime >= v.duration - 0.02) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      v.addEventListener('ended', () => resolve(), { once: true });
    });

    // 2. The lamps, 330 ms apart, on the judged frame. 3. The hold with marks, 2 s.
    const { judged } = input;
    const lit = input.lamps.some(s => s !== 'off');
    const t0 = performance.now();
    const LAMPS_MS = lit ? 330 * 3 + 420 : 600, HOLD_MS = 2000;
    await new Promise<void>(resolve => {
      const tick = () => {
        const t = performance.now() - t0;
        bg();
        const b = drawPicture(g, judged, judged.width, judged.height, input.mirror);
        g.fillStyle = `rgb(5 6 10 / ${t > 0 && lit ? 0.18 : 0.38})`; g.fillRect(0, 0, CLIP_W, CLIP_H);
        const shown = input.lamps.map((s, i) => (lit && t >= i * 330 ? s : 'off')) as LampState[];
        drawLamps(g, shown);
        if (t >= LAMPS_MS && input.marks) drawMarks(g, input.marks, b, input.mirror, input.markColour);
        if (t >= LAMPS_MS + HOLD_MS) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    rec.stop();
    await stopped;
  } finally {
    stream.getTracks().forEach(t => t.stop());
    URL.revokeObjectURL(url);
    v.remove();
  }
  const type = rec.mimeType.split(';')[0];
  const ext = type === 'video/mp4' ? 'mp4' : 'webm';
  return new File(chunks, `first-meet-try-a-lift.${ext}`, { type });
}

/**
 * Opens the share sheet with the file (Web Share level 2), or downloads it where
 * sharing files isn't supported. Returns how it went.
 */
export async function shareOrDownload(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: CLIP_LINE });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
      // NotAllowedError: the tap was too long ago to open the share sheet. Download instead.
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return 'downloaded';
}
