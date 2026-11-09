// A stand-in camera for the end-to-end tests: a sample lift drawn to a canvas stream. She
// stands still on its first frame until the squat command shows ("Squat!" on /try, "SQUAT!" on
// the platform), then squats, and stays on the last frame after, as a woman in her spot would.
import type { Page } from '@playwright/test';

export async function fakeCamera(page: Page, clip = '/samples/good-lift-wabba.mp4') {
  await page.addInitScript(src => {
    const md = navigator.mediaDevices ?? ({} as MediaDevices);
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: md });
    md.getUserMedia = async () => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.src = src;
      // On the page and seeked once, or a paused video has no frame to draw.
      v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
      document.body.appendChild(v);
      await new Promise(r => v.addEventListener('loadeddata', r, { once: true }));
      v.currentTime = 0.001;
      await new Promise(r => v.addEventListener('seeked', r, { once: true }));
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      const g = c.getContext('2d')!;
      // A pixel that changes each draw, so the stream sends frames while she stands still.
      let n = 0;
      const draw = () => {
        g.drawImage(v, 0, 0);
        g.fillStyle = n++ & 1 ? '#000' : '#010101';
        g.fillRect(0, 0, 1, 1);
        requestAnimationFrame(draw);
      };
      draw();
      const squat = () => [...document.querySelectorAll('.command .c')].some(e => /^squat!$/i.test(e.textContent ?? ''));
      new MutationObserver((_, o) => { if (squat()) { o.disconnect(); setTimeout(() => void v.play(), 300); } })
        .observe(document.body, { childList: true, subtree: true, characterData: true });
      return c.captureStream(30);
    };
  }, clip);
}
