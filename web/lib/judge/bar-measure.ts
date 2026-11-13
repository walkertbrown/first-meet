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
  /** The bar's own call, by item 70's rules. */
  shadow: ShadowCall;
  /** What the server's own caller called on its path, for information. */
  server_commands: { cmd: BarCmd['cmd']; t: number; late?: boolean; why?: PressLateWhy; void?: boolean }[];
};

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
    shadow: { light: 'close', reason: 'visibility' }, server_commands: server,
  };
  if (start === null || end === null || !s.length) return out;

  const inWin = pts.filter(p => p.t >= start && p.t <= end);
  out.lost_share = inWin.length ? +(inWin.filter(p => !p.ok).length / inWin.length).toFixed(3) : 1;
  const startY = yNear(s, start, gap);

  if (press !== null) {
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
