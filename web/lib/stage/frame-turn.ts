// Look 4b: the camera frames turned a quarter before anything sees them. With rotation lock on, a phone
// on its side still gets portrait frames, so she'd lie across them. The turned frames are what the judge,
// the grey frames, the frozen frame, the recording and so the replay, the clip and the meet card all use:
// she never sees herself lying on her side.
import type { FrameMeta } from './bar-cadence';

export class FrameTurner {
  readonly stream: MediaStream;
  private readonly raw = document.createElement('video');
  private readonly canvas = document.createElement('canvas');
  private stopped = false;
  /**
   * Item 114 (3.2, "When the phone is turned"): called right after each camera frame is drawn turned, inside the
   * camera video's own requestVideoFrameCallback, with that frame's metadata. The turned stream's own callbacks
   * would be the canvas's, not the camera's, so the bar stage runs here, on `picture`.
   */
  onFrame: ((now: number, meta: FrameMeta) => void) | null = null;

  /** `turn` +90 turns the frames clockwise, -90 the other way (frameTurn in orient.ts). */
  constructor(source: MediaStream, private readonly turn: 90 | -90, w: number, h: number) {
    this.raw.muted = true;
    this.raw.playsInline = true;
    this.raw.srcObject = source;
    // in the page, never seen: some browsers pause a video that isn't in the document
    this.raw.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(this.raw);
    // turned, a w x h frame is h x w
    this.canvas.width = h;
    this.canvas.height = w;
    this.stream = this.canvas.captureStream(30);
    void this.raw.play().catch(() => {});
    this.draw();
  }

  private draw = (now?: number, meta?: FrameMeta) => {
    if (this.stopped) return;
    const g = this.canvas.getContext('2d');
    const { width: cw, height: ch } = this.canvas;
    if (g && this.raw.readyState >= 2) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.translate(cw / 2, ch / 2);
      g.rotate((this.turn * Math.PI) / 180);
      // in the turned frame the source is drawn at its own size, centred
      g.drawImage(this.raw, -ch / 2, -cw / 2, ch, cw);
    }
    const v = this.raw as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number };
    const byFrame = !!v.requestVideoFrameCallback && this.raw.readyState >= 2;
    if (byFrame) v.requestVideoFrameCallback!(this.draw);
    else requestAnimationFrame(() => this.draw());
    // only a real camera-frame callback carries metadata: a drawing on the animation frame is not a camera frame
    if (meta && now !== undefined && g && this.raw.readyState >= 2) this.onFrame?.(now, meta);
  };

  /** The camera's video, before the turn: the video whose frame callbacks are the camera's. */
  get cameraVideo(): HTMLVideoElement { return this.raw; }
  /** The turned picture as last drawn: what the bar stage reads in onFrame. */
  get picture(): HTMLCanvasElement { return this.canvas; }

  /** the camera's own frames, before the turn */
  get rawDims() { return { w: this.raw.videoWidth, h: this.raw.videoHeight }; }

  stop() {
    this.stopped = true;
    this.stream.getTracks().forEach(t => t.stop());
    this.raw.srcObject = null;
    this.raw.remove();
  }
}
