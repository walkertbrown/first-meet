// A tiny page, served by Playwright's router, that finds poses in a clip with the
// same @mediapipe/tasks-vision build and model the site serves from /models/.
// It steps through the video at a fixed rate (default 15 frames a second) by seeking,
// so the result doesn't depend on how fast the machine is.
import type { Page } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

export const ROOT = resolve(__dirname, '../..');
const PUBLIC = join(ROOT, 'web/public');

const TYPES: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.task': 'application/octet-stream', '.html': 'text/html', '.json': 'application/json',
};

const PAGE = `<!doctype html><meta charset=utf-8><video id=v muted playsinline></video>
<script type=module>
import { FilesetResolver, PoseLandmarker } from '/models/vision_bundle.mjs';
const files = await FilesetResolver.forVisionTasks('/models/wasm');
const lm = await PoseLandmarker.createFromOptions(files, {
  baseOptions: { modelAssetPath: '/models/pose_landmarker_full.task', delegate: 'CPU' },
  runningMode: 'VIDEO', numPoses: 1,
});
const v = document.getElementById('v');
let clock = 0; // the landmarker needs ever-increasing timestamps, across clips too
const seek = t => new Promise(r => { v.addEventListener('seeked', r, { once: true }); v.currentTime = t; });
window.findPoses = async (src, fps) => {
  v.src = src;
  await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('video failed to load')); });
  const frames = []; const t0 = performance.now();
  const step = 1 / fps; let ms = 0;
  for (let t = 0; t < v.duration - 0.02; t += step) {
    await seek(t);
    ms = Math.round(t * 1000);
    const res = lm.detectForVideo(v, clock + ms);
    const p = res.landmarks && res.landmarks[0];
    frames.push({ t: ms, p: p ? p.map(q => [+q.x.toFixed(4), +q.y.toFixed(4), +(q.visibility ?? 0).toFixed(3), +q.z.toFixed(4)]) : null });
  }
  clock += ms + 1000;
  return { w: v.videoWidth, h: v.videoHeight, duration: v.duration, fps, secs: (performance.now() - t0) / 1000, frames };
};
window.ready = true;
</script>`;

export async function openPosePage(page: Page) {
  await page.route('http://fm.local/**', route => {
    const u = decodeURIComponent(new URL(route.request().url()).pathname);
    if (u === '/') return route.fulfill({ body: PAGE, contentType: 'text/html' });
    const file = u.startsWith('/clips/') ? join(ROOT, 'tests', u)
      : u.startsWith('/samples/') ? join(ROOT, 'content', u) // the sample lifts, as shipped
      : join(PUBLIC, u);
    if (!file.startsWith(ROOT)) return route.fulfill({ status: 404 });
    try { statSync(file); } catch { return route.fulfill({ status: 404 }); }
    const range = route.request().headers()['range'];
    const body = readFileSync(file);
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    if (range) {
      const [a, b] = range.replace('bytes=', '').split('-');
      const start = +a, end = b ? +b : body.length - 1;
      return route.fulfill({
        status: 206, body: body.subarray(start, end + 1), contentType: type,
        headers: { 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Accept-Ranges': 'bytes' },
      });
    }
    return route.fulfill({ body, contentType: type, headers: { 'Accept-Ranges': 'bytes' } });
  });
  await page.goto('http://fm.local/');
  await page.waitForFunction('window.ready === true', null, { timeout: 60_000 });
}

export type RawPoses = {
  w: number; h: number; duration: number; fps: number; secs: number;
  frames: { t: number; p: [number, number, number, number][] | null }[];
};

/** `clip` is a file in tests/clips/, or `/samples/<file>` for a sample lift in content/samples/. */
export async function findPoses(page: Page, clip: string, fps = 15): Promise<RawPoses> {
  const src = clip.startsWith('/samples/') ? clip : '/clips/' + clip;
  return page.evaluate(([s, f]) => (window as unknown as { findPoses: (a: string, b: number) => Promise<RawPoses> }).findPoses(s as string, f as number), [src, fps]);
}
