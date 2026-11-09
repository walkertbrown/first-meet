// Her lift, recorded on the phone (plan 3.10). Try a lift never uploads it: it's
// replayed on the stage and made into "Save my clip", then dropped with the page.
export function recorderMime(prefer: 'webm' | 'mp4' = 'webm'): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const webm = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mp4 = ['video/mp4;codecs=avc1', 'video/mp4'];
  return (prefer === 'webm' ? [...webm, ...mp4] : [...mp4, ...webm]).find(t => MediaRecorder.isTypeSupported(t));
}

export class Recording {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  /** performance.now() when it started and stopped. */
  startedAt = 0;
  stoppedAt = 0;

  /** The meet's 720p at 2.5 Mbps (Barbell) or 1.5 Mbps (Home) (3.10); Try a lift uses 2.5. */
  constructor(private bitsPerSecond = 2_500_000) {}

  get mimeType() { return this.rec?.mimeType ?? ''; }

  start(stream: MediaStream) {
    const mimeType = recorderMime('webm');
    if (!mimeType) return;
    this.chunks = [];
    try {
      this.rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: this.bitsPerSecond });
    } catch { this.rec = null; return; }
    this.rec.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(250);
    this.startedAt = performance.now();
  }

  stop(): Promise<Blob | null> {
    const rec = this.rec;
    this.stoppedAt = performance.now();
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    return new Promise(res => {
      rec.onstop = () => res(this.chunks.length ? new Blob(this.chunks, { type: rec.mimeType }) : null);
      rec.stop();
    });
  }

  get seconds() { return Math.max(0, (this.stoppedAt - this.startedAt) / 1000); }
}

/**
 * A MediaRecorder webm has no duration, so it can't be seeked until the browser has
 * read to the end once. Seeking far past the end makes it do that.
 */
export function readyToSeek(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { v.removeEventListener('error', fail); resolve(); };
    const fail = () => reject(new Error('video'));
    v.addEventListener('error', fail, { once: true });
    const go = () => {
      if (Number.isFinite(v.duration)) return done();
      v.addEventListener('durationchange', function on() {
        if (!Number.isFinite(v.duration)) return;
        v.removeEventListener('durationchange', on);
        v.currentTime = 0;
        done();
      });
      v.currentTime = 1e9;
    };
    if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true });
  });
}

export function seekTo(v: HTMLVideoElement, s: number): Promise<void> {
  return new Promise(res => {
    if (Math.abs(v.currentTime - s) < 0.01) return res();
    v.addEventListener('seeked', () => res(), { once: true });
    v.currentTime = s;
  });
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Resolves as `p` does, or rejects if `ms` passes first: for steps that must not hang the stage. */
export function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, sleep(ms).then(() => { throw new Error('timeout'); })]);
}
