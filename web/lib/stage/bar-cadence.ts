// Item 114 (3.2, "One point per camera frame"): where the browser has requestVideoFrameCallback, the bench's bar stage
// runs once per new camera frame, at that frame's own time; the refresh tick is the fallback, chosen by what happens.

export type BarCadence = 'frame' | 'refresh';

/** What requestVideoFrameCallback hands its callback (the fields the bar stage reads). */
export type FrameMeta = { captureTime?: number; expectedDisplayTime?: number; presentedFrames?: number };

/**
 * A camera frame's time, on performance.now()'s clock: `captureTime` where the browser gives it, otherwise
 * `expectedDisplayTime` (on desktop Chromium that lands on screen refreshes), otherwise when the callback ran.
 */
export function frameTimeOf(meta: FrameMeta | null | undefined, now: number): number {
  const c = meta?.captureTime, e = meta?.expectedDisplayTime;
  if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
  if (typeof e === 'number' && Number.isFinite(e) && e > 0) return e;
  return now;
}

/** The bar's time rules run this often while the tab isn't drawn, when there's no animation frame (3.2). */
export const HIDDEN_TICK_MS = 100;

/** How long the video may play with no callback at all before the attempt drops to the refresh tick. */
export const NO_CALLBACK_MS = 1000;

/**
 * The cadence for one attempt (3.2, "The fallback is chosen by what happens"). Each attempt starts on "frame". If the
 * video plays (its currentTime moves) for NO_CALLBACK_MS from the attempt's start with no callback at all, it drops to
 * "refresh" for the rest of the attempt; once one callback has come it never switches, so one bar_path has one
 * cadence. A stop after frames have come isn't a switch: the bar's 500 ms no-frame rule handles that.
 */
export class CadencePick {
  cadence: BarCadence;
  /** this attempt dropped to the refresh tick (an events row, `bar_cadence_fallback`) */
  fellBack = false;
  private callbacks = 0;
  private playingFrom: number | null = null;
  private lastMedia: number | null = null;
  private lastPresented: number | null = null;
  /** camera frames the callback saw, and those it skipped (`presentedFrames` jumping), for /ops */
  frames = 0;
  skipped = 0;

  /** `has`: the browser has requestVideoFrameCallback on the video the frames come from. */
  constructor(has: boolean) {
    this.cadence = has ? 'frame' : 'refresh';
  }

  /** A refresh tick: `now` on performance.now()'s clock, `media` the feed video's currentTime. True if it just fell back. */
  tick(now: number, media: number): boolean {
    if (this.cadence !== 'frame' || this.callbacks > 0) return false;
    if (this.lastMedia === null) { this.lastMedia = media; return false; }
    if (media !== this.lastMedia && this.playingFrom === null) this.playingFrom = now;
    this.lastMedia = media;
    if (this.playingFrom !== null && now - this.playingFrom >= NO_CALLBACK_MS) {
      this.cadence = 'refresh'; this.fellBack = true;
      return true;
    }
    return false;
  }

  /** A frame callback came. False once the attempt is on "refresh": the frame is then left to the tick. */
  frame(meta: FrameMeta | null | undefined): boolean {
    if (this.cadence !== 'frame') return false;
    this.callbacks++;
    this.frames++;
    const pf = meta?.presentedFrames;
    if (typeof pf === 'number' && Number.isFinite(pf)) {
      if (this.lastPresented !== null && pf > this.lastPresented + 1) this.skipped += pf - this.lastPresented - 1;
      this.lastPresented = pf;
    }
    return true;
  }

  /** The skipped-frame rate: frames the callback skipped over all the camera frames there were. */
  get skippedRate(): number | null {
    const all = this.frames + this.skipped;
    return all ? Math.round((this.skipped / all) * 1000) / 1000 : null;
  }
}

type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

export const hasFrameCallback = (v: HTMLVideoElement | null | undefined) =>
  !!v && typeof (v as RvfcVideo).requestVideoFrameCallback === 'function';

/** Calls `cb` on every new frame of `v` until the returned stop is called. */
export function everyFrame(v: HTMLVideoElement, cb: (now: number, meta: FrameMeta) => void): () => void {
  const rv = v as RvfcVideo;
  let on = true, h: number | null = null;
  const run = (now: number, meta: FrameMeta) => {
    if (!on) return;
    h = rv.requestVideoFrameCallback!(run);
    cb(now, meta);
  };
  if (rv.requestVideoFrameCallback) h = rv.requestVideoFrameCallback(run);
  return () => { on = false; if (h !== null) rv.cancelVideoFrameCallback?.(h); };
}

/** What BarFeed drives: MeetLift's bench stage (its grey frames are `G`). */
export interface BarFed<G, E> {
  readonly wantsBar: boolean;
  feedBar(g: G, t: number): E[];
  idleBar(t: number): E[];
}

/**
 * The bench's feed for one attempt (item 114, 3.2): on "frame", each camera frame's callback feeds the bar stage at
 * that frame's time, and the refresh tick (or the 100 ms timer while the tab isn't drawn) runs its time rules only. On
 * "refresh", each tick where the feed video moved feeds the frame on screen, at the tick's time, and a tick where it
 * didn't runs the time rules. Times are on performance.now()'s clock; the stage gets them less `t0`.
 */
export class BarFeed<G, E> {
  constructor(private readonly ml: BarFed<G, E>, readonly pick: CadencePick, private readonly t0: number) {}

  /** A camera frame's callback. Null when it isn't the bar's to feed (on "refresh", or before the tap). */
  frame(cbNow: number, meta: FrameMeta | null | undefined, grey: () => G | null): { at: number; evs: E[] } | null {
    if (!this.pick.frame(meta) || !this.ml.wantsBar) return null;
    const at = frameTimeOf(meta, cbNow);
    const g = grey();
    return g ? { at, evs: this.ml.feedBar(g, at - this.t0) } : null;
  }

  /**
   * A refresh tick at `now`. `media` is the camera video's currentTime (for the fallback), `fresh` whether the feed
   * video shows a new picture since the last tick. Runs the fallback's check on every tick, from the attempt's start.
   */
  tick(now: number, media: number, fresh: boolean, grey: () => G | null): E[] {
    this.pick.tick(now, media);
    if (!this.ml.wantsBar) return [];
    if (this.pick.cadence === 'frame' || !fresh) return this.ml.idleBar(now - this.t0);
    const g = grey();
    return g ? this.ml.feedBar(g, now - this.t0) : [];
  }
}
