// The plate tracker from phase 2's bench bar test (item 70), unchanged, plus the whole-frame search the stuck-track
// rule needs (plan 3.4b). Zero-mean normalised cross-correlation of a square template cut around the tapped point,
// searched in a window around the last position on a small grey frame. The template follows slowly when the match is
// strong. Plain TS, no dependencies, past frames only.

export type Gray = { w: number; h: number; px: Uint8Array };
export type TrackOpts = { tpl: number; search: number; follow: number; followMin: number };
export const TRACK: TrackOpts = { tpl: 0.18, search: 0.08, follow: 0.1, followMin: 0.8 };

export class PlateTracker {
  x: number; y: number; // template centre, px of the small frame
  readonly n: number; private r: number;
  t: Float32Array; tm = 0; tn = 1;
  constructor(f: Gray, fx: number, fy: number, private o: TrackOpts = TRACK) {
    this.n = Math.max(7, Math.round(o.tpl * f.h) | 1);
    this.r = Math.max(3, Math.round(o.search * f.h));
    this.x = fx * f.w; this.y = fy * f.h;
    this.t = new Float32Array(this.n * this.n);
    this.cut(f, Math.round(this.x), Math.round(this.y), this.t);
    this.norm();
  }
  private cut(f: Gray, cx: number, cy: number, out: Float32Array) {
    const n = this.n, h = n >> 1;
    for (let j = 0; j < n; j++) {
      const yy = Math.min(f.h - 1, Math.max(0, cy - h + j));
      for (let i = 0; i < n; i++) out[j * n + i] = f.px[yy * f.w + Math.min(f.w - 1, Math.max(0, cx - h + i))];
    }
  }
  norm() {
    const t = this.t; let s = 0; for (let k = 0; k < t.length; k++) s += t[k];
    this.tm = s / t.length; let v = 0; for (let k = 0; k < t.length; k++) { const d = t[k] - this.tm; v += d * d; }
    this.tn = Math.sqrt(v) || 1;
  }
  /** Score of the template centred at (cx, cy): -1..1. */
  score(f: Gray, cx: number, cy: number): number {
    const n = this.n, h = n >> 1, t = this.t, tm = this.tm;
    const x0 = cx - h, y0 = cy - h;
    if (x0 < 0 || y0 < 0 || x0 + n > f.w || y0 + n > f.h) return -2;
    let s = 0, s2 = 0, st = 0;
    for (let j = 0; j < n; j++) {
      const row = (y0 + j) * f.w + x0, tr = j * n;
      for (let i = 0; i < n; i++) { const p = f.px[row + i]; s += p; s2 += p * p; st += p * (t[tr + i] - tm); }
    }
    const N = n * n, v = s2 - (s * s) / N;
    return v <= 1e-6 ? 0 : st / (Math.sqrt(v) * this.tn);
  }
  /** Follow the plate into frame f. Returns the centre as fractions of the frame and the match score. */
  track(f: Gray): { x: number; y: number; score: number } {
    const cx = Math.round(this.x), cy = Math.round(this.y), r = this.r;
    let best = -3, bx = cx, by = cy;
    const sc = new Map<number, number>();
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const s = this.score(f, cx + dx, cy + dy);
      sc.set((dy + r) * (2 * r + 1) + dx + r, s);
      if (s > best) { best = s; bx = cx + dx; by = cy + dy; }
    }
    // sub-pixel: a parabola through the neighbours
    const at = (x: number, y: number) => sc.get((y - cy + r) * (2 * r + 1) + x - cx + r) ?? this.score(f, x, y);
    const sub = (a: number, b: number, c: number) => { const d = a - 2 * b + c; return d < 0 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * d))) : 0; };
    const fx = bx + sub(at(bx - 1, by), best, at(bx + 1, by));
    const fy = by + sub(at(bx, by - 1), best, at(bx, by + 1));
    if (best > -2) { this.x = fx; this.y = fy; }
    if (best >= this.o.followMin && this.o.follow > 0) {
      const p = new Float32Array(this.n * this.n); this.cut(f, bx, by, p);
      const a = this.o.follow; for (let k = 0; k < p.length; k++) this.t[k] = (1 - a) * this.t[k] + a * p[k];
      this.norm();
    }
    return { x: this.x / f.w, y: this.y / f.h, score: best };
  }
}

/** The tap's own template, kept as it was cut (it never follows), for the whole-frame search. */
export class TapTemplate {
  private p: PlateTracker;
  constructor(f: Gray, fx: number, fy: number, o: TrackOpts) { this.p = new PlateTracker(f, fx, fy, { ...o, follow: 0 }); }
  /** The tap template's score centred at (cx, cy), px. */
  at(f: Gray, cx: number, cy: number) { return this.p.score(f, Math.round(cx), Math.round(cy)); }
  /** The best match anywhere on the frame, px. */
  searchAll(f: Gray): { x: number; y: number; score: number } {
    const h = this.p.n >> 1; let best = -3, bx = 0, by = 0;
    for (let y = h; y < f.h - h; y++) for (let x = h; x < f.w - h; x++) { const s = this.p.score(f, x, y); if (s > best) { best = s; bx = x; by = y; } }
    return { x: bx, y: by, score: best };
  }
}

/** Re-seed a tracker on a found spot, with the tap's template. */
export function reseed(tr: PlateTracker, tap: PlateTracker, x: number, y: number) {
  tr.x = x; tr.y = y; tr.t.set(tap.t); tr.norm();
}
