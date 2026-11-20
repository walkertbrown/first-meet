// Bench commands test (plan 3.4b, item 74): the phone's caller on each rep's committed plate trace, frame by frame,
// past frames only, scored against the by-eye times. No clips or frames are needed.
//
// Usage: npx tsx tests/bench-commands/score.ts [rules override .json] [traces dir]
//        env QUIET=1 (lines only), DEBUG=<id prefix> (every frame of that rep), OUT=<file> (every rep's times as JSON),
//        ALL_REPS=1 (every rep of the gym sets, not just rep 1; see laterReps), LIVE=tick|three (the live cadence; see liveFeed),
//        ALL_REPS_OUT=<file> (writes results/commands-all-reps.json: allRepsResults)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BenchCaller, RULES, type Rel } from './caller';
import { callPath, markStuck, measureBar, type BarPoint } from '../../web/lib/judge/bar-measure';
import type { CommandTimes } from '../../web/lib/judge/zoom';

const HERE = __dirname;
const BOUNCED = ['m-k8', 'Nv9h', 'VM_y', 'xXFj'];
/** A replayed hold is a stretch this long where the reference bar stays within STILL_REF of the frame. */
const HOLD_MS = 400, STILL_REF = 0.01;
/** Line 1 is shown on clips only if at least this share of the scored reps get Press! in the clip itself. */
const SHOWN_SHARE = 0.5;

type Eye = { grp: string; settled: number; descent: number; stop: number; pauseEnd: number; backUp: number | null };
type Ref = { t: number[]; y: number[]; h: number };
type Hold = { what: 'start' | 'press' | 'rack'; from: number; to: number; still: boolean };
export type Status = 'PASS' | 'FAIL' | 'NOT SHOWN';
export type Row = {
  id: string; rep: number; group: 'meet' | 'paused' | 'bounced'; inHand: boolean;
  start: number | null; press: number | null; late: boolean; rack: number | null; noRep: boolean; lostBeforeStart: number | null;
  /** the loss before Start! was the stuck rule's (a score of freezeScore or more, still), not a low score */
  stuckBeforeStart: boolean;
  leftHooks: number | null; voided: number | null; voidAfterHooks: number | null; voidAtLoss: boolean; voidOk: boolean;
  startIn: 'clip' | 'replay' | null; pressIn: 'clip' | 'replay' | null; pressClip: number | null;
  settled: number; descent: number; stop: number; pauseEnd: number; backUpEye: number | null; delay: number | null;
  early: boolean; within1: boolean; within15: boolean; over15: boolean; startEarly: boolean; rackEarly: boolean;
  backPhone: boolean; backEye: boolean; backAgree: boolean;
  sink: number | null; sinking: boolean; refSink: number | null; refSinking: boolean;
  waits: { what: string; at: number; s: number; got: boolean; from: number; to: number; still: boolean }[]; log: string[];
  pause: number | null; pauseStuck: boolean;
  /** The clip's own camera frame (ms); each command's time in the clip (s; in a hold, the clip frame then shown), the
   *  index of the camera frame then shown, and whether it came in a hold. */
  frame: number; clipAt: Record<'start' | 'press' | 'rack', number | null>; clipFrame: Record<'start' | 'press' | 'rack', number | null>;
  inHold: Record<'start' | 'press' | 'rack', boolean>;
};

/** How far the bar goes lower after `from` before it rises by `rise` (3-frame median), in the units of y. */
function sinkAfter(pts: { t: number; y: number }[], from: number, rise: number): number | null {
  const ys = pts.map((_, i) => { const w = pts.slice(Math.max(0, i - 1), i + 2).map(q => q.y).sort((a, b) => a - b); return w[Math.floor(w.length / 2)]; });
  const i0 = pts.findIndex(q => q.t >= from);
  if (i0 < 0) return null;
  let mx = ys[i0];
  for (let i = i0; i < pts.length; i++) { mx = Math.max(mx, ys[i]); if (ys[i] < mx - rise) break; }
  return mx - ys[i0];
}

/**
 * The latest HOLD_MS stretch inside [lo, hi] (clip ms) where the reference bar stays within STILL_REF of the frame. If
 * there is none, the last HOLD_MS before hi, marked not still.
 */
function stillStretch(ref: Ref, lo: number, hi: number): { from: number; to: number; still: boolean } {
  for (let j = ref.t.length - 1; j >= 0; j--) {
    const b = ref.t[j] * 1000; if (b > hi) continue; if (b - HOLD_MS < lo) break;
    if (refStill(ref, b - HOLD_MS, b)) return { from: b - HOLD_MS, to: b, still: true };
  }
  return { from: Math.max(lo, hi - HOLD_MS), to: hi, still: false };
}

/**
 * Reps 2 and on: the HOLD_MS stretch inside [lo, hi] (clip ms) where the phone's trace moves least (x in frame heights,
 * the larger of the two ranges), or with `highest` where its lowest point is highest; the latest on a tie; all of
 * [lo, hi] when it's shorter. `still` is the reference's.
 */
function stillestStretch(pts: number[][], ref: Ref, aspect: number, lo: number, hi: number, highest = false): { from: number; to: number; still: boolean } {
  const w = pts.filter(q => q[0] >= lo && q[0] <= hi && q[3] >= 0.5);
  let best: { from: number; to: number } | null = null, bestS = Infinity;
  for (let j = 0, i = 0; j < w.length; j++) {
    while (w[j][0] - w[i][0] > HOLD_MS) i++;
    if (w[j][0] - w[i][0] < HOLD_MS - 50 && w.at(-1)![0] - w[0][0] >= HOLD_MS - 50) continue;
    const xs = w.slice(i, j + 1).map(q => q[1] * aspect), ys = w.slice(i, j + 1).map(q => q[2]);
    const sp = highest ? Math.max(...ys) : Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (j > i && sp <= bestS) { bestS = sp; best = { from: w[i][0], to: w[j][0] }; }
  }
  const b = best ?? { from: Math.max(lo, hi - HOLD_MS), to: hi };
  return { ...b, still: refStill(ref, b.from, b.to) };
}

/** Whether the reference bar stays within STILL_REF of the frame over [a, b] (clip ms). */
function refStill(ref: Ref, a: number, b: number): boolean {
  const w = ref.y.filter((y, k) => ref.t[k] * 1000 >= a && ref.t[k] * 1000 <= b && Number.isFinite(y));
  return w.length >= 3 && (Math.max(...w) - Math.min(...w)) / ref.h <= STILL_REF;
}

type GymCall = { id: string; start: [number, number]; reps: [number, number, string][] };

/**
 * Reps 2 and on of a gym set, each played as its own attempt (item 109, The Playner, Nov 16, 2:23 AM). A stand-in: no
 * lifter filmed them that way. The phone starts with the bar in hand at arm's length, at the later of 0.5 s before the
 * rep's descent and the last rep's back-up, and the clip runs to the next rep's descent (or its end). These sets went
 * from rep to rep without a settled pause, so she holds the bar as a lifter on her own attempt would: for Start!, on the
 * stillest stretch of the phone's trace before the descent; for Rack!, on its highest stretch after the back-up
 * (stillestStretch); for Press!, as on rep 1. The eye's stop and
 * pause end are calls-run1.json's; the descent is the last frame within 10% of the travel from the top before the
 * stop, and the back-up the first after the pause end, on the phone's trace (as tests/referee-bot/build-set.ts does).
 */
function laterReps(e0: Eye, pts: number[][], g: GymCall): { rep: number; e: Eye; pts: number[][] }[] {
  const reps: { descent: number; stop: number; end: number; backUp: number | null }[] = [];
  let prev = g.start[0];
  g.reps.forEach(([stop, end], i) => {
    const seg = pts.filter(q => q[0] / 1000 >= prev && q[0] / 1000 <= stop && q[3] >= 0.5);
    const top = Math.min(...seg.map(q => q[2])), low = Math.max(...seg.map(q => q[2]));
    const near = seg.filter(q => q[2] <= top + 0.1 * (low - top));
    const up = pts.find(q => q[0] / 1000 > end && q[3] >= 0.5 && q[2] <= top + 0.1 * (low - top));
    reps.push({ descent: i === 0 ? e0.descent : near.length ? near[near.length - 1][0] / 1000 : prev, stop, end,
      backUp: i === 0 ? e0.backUp : up ? up[0] / 1000 : null });
    prev = end;
  });
  const from = (i: number) => Math.max(reps[i].descent - 0.5, reps[i - 1].backUp ?? -Infinity);
  return reps.slice(1).map((r, k) => {
    const i = k + 1, a = from(i), b = i + 1 < reps.length ? reps[i + 1].descent : Infinity;
    return { rep: i + 1, e: { grp: e0.grp, settled: a, descent: r.descent, stop: r.stop, pauseEnd: r.end, backUp: r.backUp },
      pts: pts.filter(q => q[0] / 1000 >= a && q[0] / 1000 < b) };
  });
}

/**
 * The live phone's cadence (3.4b "The lights", NerdCider, Nov 20, 8:31 AM): the live tick runs on every screen refresh
 * and feeds the newest camera frame each time, so the caller sees each frame more than once, with the same x and y.
 * 'tick': a 16.7 ms tick feeding the newest frame (2 feeds a frame on these 30 fps traces, 3 on a 20 fps camera).
 * 'three': each frame fed 3 times, evenly before the next frame (the 3 feeds a frame NerdCider saw).
 */
export type Live = 'tick' | 'three';
export function liveFeed(pts: number[][], step: number, live: Live): number[][] {
  const out: number[][] = [];
  if (live === 'three') { for (const q of pts) for (let j = 0; j < 3; j++) out.push([q[0] + (j * step) / 3, q[1], q[2], q[3]]); return out; }
  const tick = 1000 / 60;
  for (let k = 0, i = 0; ; k++) {
    const T = pts[0][0] + k * tick;
    if (T >= pts.at(-1)![0] + step) break;
    while (i + 1 < pts.length && pts[i + 1][0] <= T) i++;
    out.push([T, pts[i][1], pts[i][2], pts[i][3]]);
  }
  return out;
}

/**
 * Item 111's cadence line (3.4b, the commands test): how far each command moves at a live cadence from the grid run.
 * A command in the clip, on both runs, is measured in the clip's own time and may move by at most two of the clip's
 * own camera frames (`counted`), counted as frames of the clip between the frame shown at each. A command in the stand-in's hold on either run is recorded, not counted: both ends of
 * a hold step at the feed's rate, and its wait is in `waits`. A command on one run and not the other is `missing`.
 */
export function cadenceMoves(grid: Row[], live: Row[]) {
  const out: { id: string; cmd: 'start' | 'press' | 'rack'; moved: number | null; frames: number | null; counted: boolean; missing: boolean }[] = [];
  const byId = new Map(live.map(r => [r.id, r]));
  for (const g of grid) {
    const l = byId.get(g.id); if (!l) continue;
    for (const cmd of ['start', 'press', 'rack'] as const) {
      const a = g.clipAt[cmd], b = l.clipAt[cmd];
      if (a == null && b == null) continue;
      const counted = a != null && b != null && !g.inHold[cmd] && !l.inHold[cmd];
      const moved = a != null && b != null ? +(b - a).toFixed(4) : null;
      const fa = g.clipFrame[cmd], fb = l.clipFrame[cmd];
      out.push({ id: g.id, cmd, moved, frames: fa == null || fb == null ? null : Math.abs(fb - fa), counted, missing: a == null || b == null });
    }
  }
  return out;
}

/** What results/commands-all-reps.json says it is, so no one reads the stand-in as people lifting. */
export const ALL_REPS_LABEL = 'Every rep of the gym sets. Rep 1 is the clip as filmed; reps 2 and on are a stand-in: two reps of one clip, '
  + 'each played as its own attempt, with her pause and holds played back as held frames (laterReps). Not people lifting.';

/** results/commands-all-reps.json: every rep with the product's rules, and with item 109 off to show what it holds. */
export function allRepsResults() {
  const run = (o: Partial<Rel>) => { const g = score({ ...RULES, ...o }, undefined, { allReps: true }); return { lines: g.lines, rows: g.rows }; };
  return { label: ALL_REPS_LABEL, rules: RULES, product: run({}), item109Off: run({ frozenPressMs: 0 }) };
}

export function score(rules: Rel = RULES, tracesDir = join(HERE, 'data', 'traces'), opts: {
  allReps?: boolean; live?: Live;
  /** every score lifted to at least this (a sharp camera), before the live cadence and the stand-in */
  lift?: number;
  /** her tap moved to this ms in the trace's own times: the trace starts there, the mark is the bar's point then */
  tapAt?: Record<string, number>;
  only?: string[];
} = {}) {
  const eye: Record<string, Eye> = JSON.parse(readFileSync(join(HERE, 'data', 'eyetimes.json'), 'utf8'));
  const gym: Record<string, GymCall> = Object.fromEntries(
    (JSON.parse(readFileSync(join(HERE, 'data', 'calls-run1.json'), 'utf8')).attempts as GymCall[]).map(g => [g.id, g]));
  const rows: Row[] = [];
  const files = readdirSync(tracesDir).filter(f => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  for (const f of files) {
    const pj = JSON.parse(readFileSync(join(tracesDir, f), 'utf8'));
    const id0: string = pj.id; const e0 = eye[id0]; if (!e0) continue;
    if (opts.only && !opts.only.some(o => id0.startsWith(o))) continue;
    if (opts.tapAt?.[id0] != null) {
      pj.pts = pj.pts.filter((q: number[]) => q[0] >= opts.tapAt![id0]);
      pj.mark = { x: pj.pts[0][1], y: pj.pts[0][2] };
    }
    if (opts.lift != null) pj.pts = pj.pts.map((q: number[]) => [q[0], q[1], q[2], Math.max(q[3], opts.lift!)]);
    const rj = JSON.parse(readFileSync(join(HERE, 'data', 'reference', `${id0}.json`), 'utf8'));
    const ref: Ref = { t: rj.t, y: rj.y.map((y: number | null) => (y == null ? NaN : y)), h: rj.h };
    const group = e0.grp === 'meet' ? 'meet' : BOUNCED.some(b => id0.startsWith(b)) ? 'bounced' : 'paused';
    const frame = (pj.pts.at(-1)![0] - pj.pts[0][0]) / (pj.pts.length - 1);
    const step = !opts.live ? frame : opts.live === 'tick' ? 1000 / 60 : frame / 3;
    const plays = [{ rep: 1, e: e0, pts: pj.pts as number[][] }, ...(opts.allReps && gym[id0] ? laterReps(e0, pj.pts, gym[id0]) : [])];
    for (const { rep, e, pts: pts0 } of plays) {
    const pts = opts.live ? liveFeed(pts0, frame, opts.live) : pts0;
    const id = rep === 1 ? id0 : `${id0}-r${rep}`, racked: boolean = rep === 1 ? pj.racked : false;
    const dbg = process.env.DEBUG && id.startsWith(process.env.DEBUG);
    const cut1 = (e.descent - 0.1) * 1000, cut2 = e.pauseEnd * 1000;

    // She waits for each command. The lifters in these clips followed a real referee, not this phone. So if the phone
    // hasn't called Start! by the eye's descent (less 0.1 s), or Press! by the moment she rose from the bottom, she holds
    // the bar: the clip stops at the end of the latest still stretch before then (HOLD_MS where the reference bar stays
    // within 1% of the frame, after the bar settled, or after the stop), that stretch plays back and forth until the
    // command comes, plus 0.3 s to react, and the clip goes on from there. She waits at most 3 s for Press!. For Start!
    // she waits until it comes or the phone voids the attempt, at most voidMs + 1 s. Every later time, by eye and by
    // phone, moves by the wait. Whether she has to wait is found by running the clip without that wait first.
    const run = (holds: Hold[]) => {
      const c = new BenchCaller({ x: pj.mark.x, y: pj.mark.y }, { w: pj.w, h: pj.h }, rules, racked);
      const ct: Record<string, number> = {}, ctClip: Record<string, number> = {}, inHold: Record<string, boolean> = {};
      let late = false, noRep = false, voided: number | null = null, off = 0, holding: string | null = null;
      const log: string[] = [], fed: { t: number; y: number }[] = [], waits: Row['waits'] = [], path: BarPoint[] = [];
      let state1: string | null = null, state2: string | null = null;
      const feed = (t: number, clip: number, x: number, y: number, sc: number) => {
        if (sc >= rules.lostScore) fed.push({ t, y });
        path.push([t, x, y, sc]);
        const cmd = c.feed(t, x, y, sc);
        if (dbg && holds.length === 2) console.log(`   ${(t / 1000).toFixed(2)} ${c.state} y ${y.toFixed(3)} sc ${sc.toFixed(2)} v ${c.speeds.at(-1)?.v.toFixed(3) ?? '-'}`);
        if (cmd?.void) { voided = cmd.t / 1000; log.push(`Rack!(void) ${(cmd.t / 1000).toFixed(2)}`); return; }
        if (cmd) {
          if (ct[cmd.cmd] === undefined) { ct[cmd.cmd] = cmd.t / 1000; ctClip[cmd.cmd] = clip / 1000; inHold[cmd.cmd] = holding === cmd.cmd; }
          if (cmd.late) late = true; if (cmd.noRep) noRep = true;
          log.push(`${cmd.cmd}${cmd.late ? '(late)' : ''}${cmd.noRep ? '(no rep)' : ''} ${(cmd.t / 1000).toFixed(2)}`);
        }
      };
      const hold = (h: Hold) => {
        const seg = pts.filter(q => q[0] >= h.from && q[0] <= h.to);
        if (seg.length < 2) return;
        const loop = [...seg, ...seg.slice(1, -1).reverse()], max = h.what === 'start' ? rules.voidMs + 1000 : 3000;
        const base = h.to + step + off; let k = 0, gotAt = -1; holding = h.what;
        while (k * step < max && voided == null) {
          if (ct[h.what] !== undefined && gotAt < 0) gotAt = k;
          if (gotAt >= 0 && (k - gotAt) * step >= 300) break;
          const q = loop[k % loop.length]; feed(base + k * step, q[0], q[1], q[2], q[3]); k++;
        }
        holding = null;
        waits.push({ what: h.what, at: h.to / 1000, s: +((k * step) / 1000).toFixed(3), got: ct[h.what] !== undefined, from: h.from / 1000, to: h.to / 1000, still: h.still });
        off += k * step;
      };
      const todo = [...holds];
      for (const [t, x, y, sc] of pts) {
        if (state1 === null && t >= cut1) state1 = c.state;
        if (state2 === null && t >= cut2) state2 = c.state;
        while (todo.length && t > todo[0].to) hold(todo.shift()!);
        if (voided != null) break; // void: she racks the bar, and the clip is over for the phone
        feed(t + off, t, x, y, sc);
      }
      while (todo.length && voided == null) hold(todo.shift()!); // a hold at the clip's end (reps 2 and on: Rack!)
      return { c, ct, ctClip, inHold, late, noRep, voided, log, fed, waits, state1, state2, path };
    };
    const holds: Hold[] = [];
    let r = run(holds);
    if (r.state1 === 'racked' || r.state1 === 'waiting') {
      const lo = Math.max(e.settled * 1000, cut1 - HOLD_MS);
      holds.push({ what: 'start', ...(rep > 1 ? stillestStretch(pts, ref, pj.w / pj.h, e.settled * 1000, cut1)
        : process.env.STILL_START === '1' ? stillStretch(ref, e.settled * 1000, cut1) : { from: lo, to: cut1, still: refStill(ref, lo, cut1) }) });
      r = run(holds);
    }
    if (r.state2 === 'lifting') { holds.push({ what: 'press', ...stillStretch(ref, e.stop * 1000, cut2) }); r = run(holds); }
    if (rep > 1 && r.ct.press !== undefined && r.ct.rack === undefined && r.voided == null && e.backUp != null) {
      holds.push({ what: 'rack', ...stillestStretch(pts, ref, pj.w / pj.h, e.backUp * 1000, pts.at(-1)![0], true) }); r = run(holds);
    }
    const { c, ct, ctClip, inHold, late, noRep, voided, log, fed, waits, path } = r;

    const sh = (sec: number | null) => (sec == null ? null : sec + waits.filter(w => w.at < sec).reduce((a, w) => a + w.s, 0));
    const E = { settled: e.settled, descent: sh(e.descent)!, stop: sh(e.stop)!, pauseEnd: sh(e.pauseEnd)!, backUp: sh(e.backUp) };
    // Press! while sinking: after Press!, the bar goes more than 1% of the frame lower before it rises (3-frame median),
    // on the phone's trace (as fed, replay included) and, when Press! came in the clip, on the reference trace.
    const sink = ct.press != null ? sinkAfter(fed.map(q => ({ t: q.t / 1000, y: q.y })), ct.press, 0.01) : null;
    const pressIn = ct.press == null ? null : inHold.press ? 'replay' : 'clip';
    const refPts = ref.t.map((t, k) => ({ t, y: ref.y[k] / ref.h })).filter(q => Number.isFinite(q.y));
    const refSink = pressIn === 'clip' ? sinkAfter(refPts, ctClip.press, 0.01) : null;
    const delay = ct.press != null ? ct.press - E.stop : null;
    // The Pause line as the server reads it under item 110 (NerdCider, Nov 20, 9:01 AM; 3.4d step 11): the phone's own
    // path as fed, from the tap, with the phone's command times, item 108's guard put on (markStuck), then measureBar, as
    // web/lib/queue.ts does. `pauseStuck` (item 111): it reads "not measured", and the live stuck rule after Start! (as
    // callPath re-runs it) marked frames lost from pauseLostMs before the eye's stop to Press! that it wouldn't mark with
    // the rule off. Item 108's guard alone doesn't count.
    const ms = (x: number) => Math.round(x * 1000);
    const ctm = ct.start != null && ct.press != null ? {
      loaded: 0, plate_tap: { x: pj.mark.x, y: pj.mark.y, size: 0.05 }, start: ms(ct.start),
      ...(late ? { press_late: ms(ct.press), press_late_why: c.lostPress ? 'lost' : 'still' } : { press: ms(ct.press) }),
      ...(ct.rack != null ? { rack: ms(ct.rack) } : {}),
    } as unknown as CommandTimes : null;
    const readWith = (rr: Rel) => (ctm ? measureBar(markStuck(path, ctm, rr).path, ctm, { w: pj.w, h: pj.h }, rr) : null);
    const read = readWith(rules);
    const pause = read?.pause_s ?? null;
    const liveLost = (rr: Rel) => (ctm ? callPath(path, ctm, { w: pj.w, h: pj.h }, rr).seen : []);
    const seenOn = read != null && pause === null ? liveLost(rules) : [], seenOff = seenOn.length ? liveLost({ ...rules, freezeAfterMs: 0 }) : [];
    const pauseStuck = seenOn.some((ok, i) => !ok && seenOff[i] && path[i][0] >= ms(E.stop) - rules.pauseLostMs && path[i][0] <= ms(ct.press!));
    const backPhone = c.reachedTop && ct.press != null && ct.rack != null && !noRep && voided == null;
    // A missed Start! is safe only if the void comes: Rack! within voidMs (one frame's slack) of leaving the hooks, or at the loss.
    const leftHooks = c.leftAt == null ? null : c.leftAt / 1000, lostAt = c.lostBeforeStart == null ? null : c.lostBeforeStart / 1000;
    const voidAfterHooks = voided != null && leftHooks != null ? +(voided - leftHooks).toFixed(3) : null;
    const voidAtLoss = voided != null && voided === lostAt;
    const voidOk = voided != null && ((voidAfterHooks != null && voidAfterHooks <= (rules.voidMs + step) / 1000 + 1e-9) || voidAtLoss);
    const backEye = E.backUp != null;
    // The camera frame shown at a clip time: the last of the rep's own frames at or before it.
    const shown = (sec: number | undefined) => {
      if (sec == null) return null;
      let lo = 0, hi = pts0.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pts0[m][0] <= sec * 1000 + 1e-6) lo = m; else hi = m - 1; }
      return lo;
    };
    rows.push({
      id, rep, group, inHand: !racked, start: ct.start ?? null, press: ct.press ?? null, late, rack: ct.rack ?? null, noRep,
      lostBeforeStart: lostAt, stuckBeforeStart: c.lostBeforeStart != null && c.frozeAt.includes(c.lostBeforeStart), leftHooks, voided, voidAfterHooks, voidAtLoss, voidOk,
      startIn: ct.start == null ? null : inHold.start ? 'replay' : 'clip', pressIn, pressClip: ctClip.press ?? null,
      settled: E.settled, descent: E.descent, stop: E.stop, pauseEnd: E.pauseEnd, backUpEye: E.backUp, delay,
      early: delay != null && delay < 0, within1: delay != null && delay >= 0 && delay <= 1, within15: delay != null && delay >= 0 && delay <= 1.5,
      over15: delay != null && delay > 1.5 && !late,
      startEarly: ct.start != null && ct.start < E.settled,
      rackEarly: ct.rack != null && (E.backUp == null ? !noRep : ct.rack < E.backUp),
      backPhone, backEye, backAgree: backPhone === backEye,
      frame, clipAt: { start: ctClip.start ?? null, press: ctClip.press ?? null, rack: ctClip.rack ?? null },
      clipFrame: { start: shown(ctClip.start), press: shown(ctClip.press), rack: shown(ctClip.rack) },
      inHold: { start: !!inHold.start, press: !!inHold.press, rack: !!inHold.rack },
      pause, pauseStuck, sink, sinking: sink != null && sink > 0.01, refSink, refSinking: refSink != null && refSink > 0.01, waits, log,
    });
    }
  }
  const scored = rows.filter(r => r.group !== 'bounced'), n = scored.length;
  const tag = (r: Row) => r.id.slice(0, 4) + (r.rep > 1 ? `-r${r.rep}` : '');
  const ids = (l: Row[]) => (l.length ? l.map(tag).join(', ') : 'none');
  const pc = (x: number | null) => (x == null ? '-' : `${(100 * x).toFixed(1)}%`);
  const inClip = scored.filter(r => r.pressIn === 'clip'), replay = scored.filter(r => r.pressIn === 'replay');
  const sinkIn = inClip.filter(r => r.sinking || r.refSinking || r.early), early = scored.filter(r => r.early);
  const replaySink = replay.filter(r => r.sinking);
  const notStill = rows.filter(r => r.waits.some(w => w.what === 'press' && !w.still));
  const w1 = scored.filter(r => r.within1), w15 = scored.filter(r => r.within15), o15 = scored.filter(r => r.over15);
  const sE = rows.filter(r => r.startEarly), rE = rows.filter(r => r.rackEarly), bD = scored.filter(r => !r.backAgree);
  const noStart = rows.filter(r => r.start == null), noVoid = noStart.filter(r => !r.voidOk), sV = scored.filter(r => r.voided != null);
  const st = (pass: boolean): Status => (pass ? 'PASS' : 'FAIL');
  const line1: Status = sinkIn.length || early.length ? 'FAIL' : inClip.length < SHOWN_SHARE * n ? 'NOT SHOWN' : 'PASS';
  const lines = {
    line1: {
      status: line1,
      text: `1. No Press! while the bar is still going down (more than 1% of the frame lower after Press!, 3-frame median), on the reps where Press! came in the clip: ` +
        `${inClip.length} of ${n} (${ids(inClip)}). Sinking, on the phone's trace or the reference: ${sinkIn.length} (${ids(sinkIn)}). ` +
        `Largest: phone ${pc(Math.max(0, ...inClip.map(r => r.sink ?? 0)))}, reference ${pc(Math.max(0, ...inClip.map(r => r.refSink ?? 0)))}. ` +
        `Press! before the stop: ${early.length}. In the replay (${replay.length} reps, not scored): sinking on the phone's trace ${replaySink.length} (${ids(replaySink)}). ` +
        `Shown on clips only if at least ${SHOWN_SHARE * 100}% of reps get Press! in the clip`,
    },
    line2: { status: st(w1.length >= 0.9 * n && !o15.length), text: `2. Press! within 1 s of the stop on at least 90%: ${w1.length} of ${n}; past 1.5 s and not late: ${o15.length} (${ids(o15)}). Within 1.5 s: ${w15.length} of ${n}. Latest: ${Math.max(...scored.map(r => r.delay ?? 0)).toFixed(2)} s` },
    line3: {
      status: st(!sE.length && !noVoid.length),
      text: `3. No Start! before the bar settled, all ${rows.length} reps: ${sE.length} early (${ids(sE)}). No Start!: ${ids(noStart)}; each must be voided within ${rules.voidMs / 1000} s of leaving the hooks, or at the loss: ` +
        noStart.map(r => `${tag(r)} void ${r.voidAfterHooks?.toFixed(2) ?? '-'} s after leaving the hooks${r.voidAtLoss ? ' (at the loss)' : ''}${r.voidOk ? '' : ' (NOT OK)'}`).join('; '),
    },
    line4: { status: st(!rE.length && !noVoid.length), text: `4. No Rack! before the bar is back up, all ${rows.length} reps: ${rE.length} early (${ids(rE)}). A rep with no Start! passes only by the void's Rack!: ${noStart.length - noVoid.length} of ${noStart.length}` },
    line5: { status: st(!bD.length), text: `5. "Back up" agrees with the eye, ${n} reps: ${n - bD.length} of ${n} (disagree: ${ids(bD)})` },
    line6: { status: st(!sV.length), text: `6. No scored rep voided, ${n} reps: ${sV.length} (${ids(sV)})` },
  };
  const notes = {
    holds: `Pauses with no still stretch of ${HOLD_MS / 1000} s in the reference (the last ${HOLD_MS / 1000} s of the pause, or all of it, was replayed instead): ${ids(notStill)}`,
  };
  return { rows, lines, notes, n };
}

if (process.argv[1]?.endsWith('score.ts')) {
  const o = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : {};
  const { rows, lines, notes } = score({ ...RULES, ...o }, process.argv[3], { allReps: process.env.ALL_REPS === '1', live: (process.env.LIVE || undefined) as Live | undefined });
  const f2 = (x: number | null) => (x == null ? '-' : x.toFixed(2));
  const pc = (x: number | null) => (x == null ? '-' : `${(100 * x).toFixed(1)}%`);
  if (process.env.QUIET !== '1') for (const r of rows) {
    console.log(`${(r.id.slice(0, 5) + (r.rep > 1 ? `-r${r.rep}` : '')).padEnd(8)} ${r.group.padEnd(7)} ${r.inHand ? 'hand' : 'rack'} ${r.log.join(', ').padEnd(46)}| settled ${f2(r.settled)} descent ${f2(r.descent)} stop ${f2(r.stop)} rose ${f2(r.pauseEnd)} back up ${f2(r.backUpEye)}` +
      ` | Start! in ${r.startIn ?? '-'}, Press! in ${r.pressIn ?? '-'}, Press!-stop ${f2(r.delay)} sink ${pc(r.sink)} ref ${pc(r.refSink)}` +
      `${r.waits.length ? ' | waits ' + r.waits.map(w => `${w.what} ${w.s.toFixed(2)} s on ${w.from.toFixed(2)}-${w.to.toFixed(2)}${w.still ? '' : ' (not still)'}${w.got ? '' : ' (none)'}`).join(', ') : ''}` +
      `${r.lostBeforeStart != null ? ` | lost before Start! at ${f2(r.lostBeforeStart)}` : ''}${r.start == null ? ` | off the hooks ${f2(r.leftHooks)}, void ${f2(r.voided)}` : ''}`);
  }
  for (const l of Object.values(lines)) console.log(`${l.text} -> ${l.status}`);
  console.log(notes.holds);
  if (process.env.ALL_REPS_OUT) writeFileSync(process.env.ALL_REPS_OUT, JSON.stringify(allRepsResults(), null, 1) + '\n');
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ rules: { ...RULES, ...o }, lines, notes, rows }, null, 1) + '\n');
}
