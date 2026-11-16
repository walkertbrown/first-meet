// The server's side of the bench (plan 3.4b, "The lights"): every Barbell bench goes to a referee, and the
// server follows the plate again from `plate_tap` on its own 15 fps frames. From that path it measures the
// pause before the phone's "Press!", "Press! while sinking", and `shadow_lights`, the bar's own call by item 70's
// rules, kept for /ops and never shown to her or a referee.
//
// The unit is the frame's height; y grows downward. Points under `lostScore`, and stretches the caller's stuck-track
// rule took out, count as lost.
import { BAR_RULES, BarCaller, type BarCmd, type BarRel } from './bar-caller';
import type { CommandTimes } from './zoom';

/** Where she tapped and the template's size, fractions of the frame (3.4b). */
export type PlateTap = { x: number; y: number; size: number };
export type PressLateWhy = 'still' | 'lost';
/** A path point as the worker posts it: [t ms, x, y, score], x and y fractions of the frame. */
export type BarPoint = [number, number, number, number];

/** The keys in `command_times` that aren't command times (3.4b). */
export const COMMAND_EXTRAS = ['plate_tap', 'press_late_why'] as const;
export const isCommandExtra = (k: string) => (COMMAND_EXTRAS as readonly string[]).includes(k);

const frac = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** `plate_tap` from command_times, when it's whole: x and y on the frame, a size above 0. */
export function plateTap(ct: CommandTimes | null | undefined): PlateTap | null {
  const t = (ct as Record<string, unknown> | null | undefined)?.plate_tap as Partial<PlateTap> | undefined;
  if (!t || typeof t !== 'object') return null;
  return frac(t.x) && frac(t.y) && frac(t.size) && t.size! > 0 ? { x: t.x!, y: t.y!, size: t.size! } : null;
}

export function pressLateWhy(ct: CommandTimes | null | undefined): PressLateWhy | null {
  const w = (ct as Record<string, unknown> | null | undefined)?.press_late_why;
  return w === 'still' || w === 'lost' ? w : null;
}

/** The extras are well formed, or absent: a broken one is a command_times close call, like a broken time. */
export function extrasOk(ct: CommandTimes): boolean {
  const o = ct as Record<string, unknown>;
  if ('plate_tap' in o && !plateTap(ct)) return false;
  if ('press_late_why' in o && (!pressLateWhy(ct) || !('press_late' in o))) return false;
  return true;
}

/** Only the command times, without the extras. */
export function timesOnly(ct: CommandTimes): Record<string, number> {
  return Object.fromEntries(Object.entries(ct).filter(([k]) => !isCommandExtra(k))) as Record<string, number>;
}

export type ShadowCall = { light: 'white' | 'red' | 'close'; reason: 'no_lockout' | 'no_pause' | 'visibility' | 'short_pause' | null };

export type BarMeasures = {
  /** How long the bar was still before the phone's "Press!": within 5% of the rep's travel of its lowest point. */
  pause_s: number | null;
  /** How far the bar went lower after "Press!" before it rose, in frame heights. */
  sink: number | null;
  /** More than 1% of the frame lower after "Press!" (3.4b). */
  press_while_sinking: boolean;
  /** Share of the Start!-to-Rack! window where the plate was lost. */
  lost_share: number | null;
  /** The phone called a late Press! after losing the bar (`press_late_why: lost`). */
  lost_after_start: boolean;
  /**
   * A lost or stuck frame fell from `pauseLostMs` before the path's lowest seen point to Press! (or Rack!), so the
   * pause isn't measured across it (item 108): "Pause: not measured. The phone lost the bar.", and no sinking line.
   */
  pause_lost: boolean;
  /** The bar's own call, by item 70's rules. */
  shadow: ShadowCall;
  /** What the server's own caller called on its path, for information. */
  server_commands: { cmd: BarCmd['cmd']; t: number; late?: boolean; why?: PressLateWhy; void?: boolean }[];
};

/**
 * 3.4b, item 108, "A track that sticks at a lower score, found after the lift": the stretches between "Start!" and
 * "Rack!" (or the path's end) where x and y both stay within `stuckStill` of the frame for `stuckMs` or more,
 * whatever the score. A racked bar or her setting up is still too, so only that window is checked. A stretch's
 * length is its number of frames times the frame time (the mean gap between the window's frames, dropped frames left out), never last time
 * minus first on rounded ms (The Playner, Nov 16, 2:21 AM): 16 frames at 15 fps is 1.07 s.
 *
 * Her lockout hold is never marked (The Playner, 2:27 AM; NerdCider, 2:23 AM: hIuj's lost-track cut holds still
 * 1.67 s at arm's length for a late "Rack!"): a stretch that starts after "Press!" (or after the path's lowest seen
 * point when there's no "Press!") and stays within the back-up band, `rackRel` of the rep's travel from its Start!
 * height, is left alone. A still stretch after "Press!" below that band, on the way up, is still marked.
 * Returns [first, last] ms of each stretch.
 */
export function stuckStretches(path: BarPoint[], ct: CommandTimes, r: BarRel = BAR_RULES): [number, number][] {
  const start = ct.start ?? null;
  if (start === null || !path.length) return [];
  const end = ct.rack ?? path[path.length - 1][0];
  const w = path.filter(([t]) => t >= start && t <= end);
  const out: [number, number][] = [];
  if (w.length < 2) return out;
  const gaps = w.slice(1).map(([t], k) => t - w[k][0]).sort((a, b) => a - b);
  // the mean of the gaps near the median, so ms rounding (66, 67, 67…) and a dropped frame don't move it
  const med = gaps[Math.floor(gaps.length / 2)], even = gaps.filter(g => g <= med * 1.5);
  const frame = even.reduce((a, g) => a + g, 0) / even.length;
  const eps = 1e-9;
  for (let i = 0, j = 0; i < w.length; i++) {
    // the furthest j with every point i..j inside a still box
    if (j < i) j = i;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = i; k <= j; k++) {
      x0 = Math.min(x0, w[k][1]); x1 = Math.max(x1, w[k][1]); y0 = Math.min(y0, w[k][2]); y1 = Math.max(y1, w[k][2]);
    }
    while (j + 1 < w.length) {
      const [, x, y] = w[j + 1];
      if (Math.max(x1, x) - Math.min(x0, x) > r.stuckStill + eps || Math.max(y1, y) - Math.min(y0, y) > r.stuckStill + eps) break;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      j++;
    }
    if ((j - i + 1) * frame < r.stuckMs - eps) continue;
    const last = out[out.length - 1];
    if (last && w[i][0] <= last[1]) last[1] = Math.max(last[1], w[j][0]);
    else out.push([w[i][0], w[j][0]]);
  }
  if (!out.length) return out;
  const hold = lockoutHold(w, ct, r);
  return hold ? out.filter(([a, b]) => !hold(a, b)) : out;
}

/**
 * Whether a still stretch [a, b] is her lockout hold: it starts after "Press!" (else after the lowest seen point)
 * and every point in it is within the back-up band of the Start! height. Measured on the seen points' 3-frame
 * median, as `measureBar` does. Null when there's no Start! height or travel to measure the band by.
 */
function lockoutHold(w: BarPoint[], ct: CommandTimes, r: BarRel): ((a: number, b: number) => boolean) | null {
  const s = smooth(w.map(([t, , y, score]) => ({ t, y, ok: score >= r.lostScore })));
  if (!s.length) return null;
  const startY = yNear(s, ct.start!, 1000 / 15 * 3);
  if (startY === null) return null;
  const low = Math.max(...s.map(p => p.y));
  const lowAt = s.find(p => p.y === low)!.t;
  const after = ct.press ?? ct.press_late ?? lowAt;
  const back = r.rackRel * Math.max(0, low - startY);
  return (a, b) => a > after && w.every(([t, , y]) => t < a || t > b || y - startY <= back);
}

/**
 * The server's path with its stuck frames marked the way lost frames are (score 0), so the path breaks there on
 * the referee's page (look 5.14c), `measureBar` reads them as lost, and no point in them counts for the frames job
 * (3.4d step 1). Run on the server's path after the lift, before it's saved: it never changes a live command.
 */
export function markStuck(path: BarPoint[], ct: CommandTimes, r: BarRel = BAR_RULES): { path: BarPoint[]; stuck: [number, number][] } {
  const stuck = stuckStretches(path, ct, r);
  if (!stuck.length) return { path, stuck };
  return { path: path.map(p => (stuck.some(([a, b]) => p[0] >= a && p[0] <= b) ? [p[0], p[1], p[2], 0] : p)), stuck };
}

type Pt = { t: number; y: number; ok: boolean };

/** 3-frame median of y on the tracked points. */
function smooth(pts: Pt[]): Pt[] {
  const ok = pts.filter(p => p.ok);
  return ok.map((p, i) => {
    const w = ok.slice(Math.max(0, i - 1), i + 2).map(q => q.y).sort((a, b) => a - b);
    return { ...p, y: w[Math.floor(w.length / 2)] };
  });
}

/** The tracked y nearest to t, if one is within `gap` ms. */
function yNear(s: Pt[], t: number, gap: number): number | null {
  let best: Pt | null = null;
  for (const p of s) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best && Math.abs(best.t - t) <= gap ? best.y : null;
}

/** How far the bar goes lower after `from` before it rises by `rise` (the bench commands test's sinkAfter). */
export function sinkAfter(s: Pt[], from: number, rise: number): number | null {
  const i0 = s.findIndex(q => q.t >= from);
  if (i0 < 0) return null;
  let mx = s[i0].y;
  for (let i = i0; i < s.length; i++) { mx = Math.max(mx, s[i].y); if (s[i].y < mx - rise) break; }
  return mx - s[i0].y;
}

/**
 * Measures one bench attempt from the server's plate path and the phone's command times.
 * `dims` is the clip's shown size (the caller needs its shape for sideways speed).
 */
/**
 * The server's own caller run on the path: what it called, and which points were the bar. A point
 * wasn't the bar when the tracker scored it lost or its stuck-track rule froze it (look 5.13: the
 * referee's path breaks there).
 */
export function callPath(path: BarPoint[], ct: CommandTimes, dims: { w: number; h: number }, r: BarRel = BAR_RULES) {
  const tap = plateTap(ct);
  const caller = new BarCaller(tap ?? { x: path[0]?.[1] ?? 0, y: path[0]?.[2] ?? 0 }, dims, r);
  const server: BarMeasures['server_commands'] = [];
  for (const [t, x, y, score] of path) {
    const c = caller.feed(t, x, y, score);
    if (c) server.push({ cmd: c.cmd, t: c.t, ...(c.late ? { late: true } : {}), ...(c.why ? { why: c.why } : {}), ...(c.void ? { void: true } : {}) });
  }
  const frozen = new Set<number>();
  for (const f of caller.frozeAt) for (const [t] of path) if (t >= f - r.freezeMs && t <= f) frozen.add(t);
  const seen = path.map(([t, , , score]) => score >= r.lostScore && !frozen.has(t));
  return { server, seen };
}

export function measureBar(path: BarPoint[], ct: CommandTimes, dims: { w: number; h: number }, r: BarRel = BAR_RULES): BarMeasures {
  const { server, seen } = callPath(path, ct, dims, r);
  const pts: Pt[] = path.map(([t, , y], i) => ({ t, y, ok: seen[i] }));
  const s = smooth(pts);

  const start = ct.start ?? null;
  const press = ct.press ?? ct.press_late ?? null;
  const late = ct.press == null && ct.press_late != null;
  const end = ct.rack ?? (path.length ? path[path.length - 1][0] : null);
  const why = pressLateWhy(ct);
  const gap = 1000 / 15 * 3; // three of the server's frames
  const out: BarMeasures = {
    pause_s: null, sink: null, press_while_sinking: false, lost_share: null, lost_after_start: why === 'lost',
    pause_lost: false, shadow: { light: 'close', reason: 'visibility' }, server_commands: server,
  };
  if (start === null || end === null || !s.length) return out;

  const inWin = pts.filter(p => p.t >= start && p.t <= end);
  out.lost_share = inWin.length ? +(inWin.filter(p => !p.ok).length / inWin.length).toFixed(3) : 1;
  const startY = yNear(s, start, gap);

  // Item 108: any lost or stuck frame from pauseLostMs before the lowest seen point to Press! (or Rack!) means the
  // pause isn't measured across it. No seen point there at all is the same.
  const to = press ?? end;
  const seenTo = s.filter(p => p.t >= start && p.t <= to);
  if (seenTo.length) {
    const low = Math.max(...seenTo.map(p => p.y));
    const lowAt = seenTo.find(p => p.y === low)!.t;
    out.pause_lost = pts.some(p => !p.ok && p.t >= lowAt - r.pauseLostMs && p.t <= to);
  } else out.pause_lost = pts.some(p => p.t >= start && p.t <= to);

  // After a lost track (`press_late_why: lost`) the phone had no bar at Press!, so neither the pause nor a sink
  // after it can be known (5.33, item 107): a path the tracker found again later isn't measured across the gap.
  if (press !== null && why !== 'lost' && !out.pause_lost) {
    // the pause: back from Press!, the stretch the bar stayed within 5% of the rep's travel of its lowest point
    const before = s.filter(p => p.t >= start && p.t <= press);
    if (startY !== null && before.length) {
      const low = Math.max(...before.map(p => p.y));
      const band = r.rackRel * Math.max(0, low - startY);
      let from = press;
      for (let i = before.length - 1; i >= 0 && before[i].y >= low - band; i--) from = before[i].t;
      out.pause_s = +((press - from) / 1000).toFixed(2);
    }
    const sk = sinkAfter(s, press, r.sinkAfterPress);
    out.sink = sk === null ? null : +sk.toFixed(4);
    out.press_while_sinking = sk !== null && sk > r.sinkAfterPress;
  }
  out.shadow = shadowCall(s, { start, press, late, end, startY, lostShare: out.lost_share }, r, gap);
  return out;
}

/** Item 70's call, with 3.4b's back-up band. A red only ever follows a Press! the phone called. */
function shadowCall(s: Pt[], c: { start: number; press: number | null; late: boolean; end: number; startY: number | null; lostShare: number },
  r: BarRel, gap: number): ShadowCall {
  const close = (reason: 'visibility' | 'short_pause'): ShadowCall => ({ light: 'close', reason });
  if (c.startY === null || c.lostShare > r.lostShare) return close('visibility');
  const win = s.filter(p => p.t >= c.start && p.t <= c.end);
  if (!win.length) return close('visibility');
  const low = Math.max(...win.map(p => p.y));
  const back = r.rackRel > 0 ? r.rackRel * (low - c.startY) : r.rackBack;
  if (c.press === null) {
    // a rep back up with no Press! (item 70's short-pause rule), else nothing to judge
    const lowAt = win.find(p => p.y === low)!.t;
    const cameBack = low - c.startY >= r.pressDown && win.some(p => p.t > lowAt && p.y - c.startY! <= back);
    return close(cameBack ? 'short_pause' : 'visibility');
  }
  if (c.late) return close('visibility');
  // lost at the bottom (around Press!) or the top (around Rack!)
  if (yNear(s, c.press, gap) === null || yNear(s, c.end, gap) === null) return close('visibility');
  const before = win.filter(p => p.t <= c.press!);
  const lowBefore = Math.max(...before.map(p => p.y));
  const atPress = yNear(s, c.press, gap)!;
  if (lowBefore - atPress > r.pauseRise) return { light: 'red', reason: 'no_pause' };
  const after = win.filter(p => p.t >= c.press!);
  const lowAfter = Math.max(...after.map(p => p.y));
  const lowAt = after.find(p => p.y === lowAfter)!.t;
  const up = after.some(p => p.t >= lowAt && p.y - c.startY! <= back);
  return up ? { light: 'white', reason: null } : { light: 'red', reason: 'no_lockout' };
}

/** `shadow_lights`, like `lights`: three of the call, or null on a close call. */
export const shadowLights = (c: ShadowCall): ('white' | 'red')[] | null => (c.light === 'close' ? null : [c.light, c.light, c.light]);
