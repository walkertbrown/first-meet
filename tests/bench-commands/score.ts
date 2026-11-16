// Bench commands test (plan 3.4b, item 74): the phone's caller on each rep's committed plate trace, frame by frame,
// past frames only, scored against the by-eye times. No clips or frames are needed.
//
// Usage: npx tsx tests/bench-commands/score.ts [rules override .json] [traces dir]
//        env QUIET=1 (lines only), DEBUG=<id prefix> (every frame of that rep), OUT=<file> (every rep's times as JSON)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BenchCaller, RULES, type Rel } from './caller';

const HERE = __dirname;
const BOUNCED = ['m-k8', 'Nv9h', 'VM_y', 'xXFj'];
/** A replayed hold is a stretch this long where the reference bar stays within STILL_REF of the frame. */
const HOLD_MS = 400, STILL_REF = 0.01;
/** Line 1 is shown on clips only if at least this share of the scored reps get Press! in the clip itself. */
const SHOWN_SHARE = 0.5;

type Eye = { grp: string; settled: number; descent: number; stop: number; pauseEnd: number; backUp: number | null };
type Ref = { t: number[]; y: number[]; h: number };
type Hold = { what: 'start' | 'press'; from: number; to: number; still: boolean };
export type Status = 'PASS' | 'FAIL' | 'NOT SHOWN';
export type Row = {
  id: string; group: 'meet' | 'paused' | 'bounced'; inHand: boolean;
  start: number | null; press: number | null; late: boolean; rack: number | null; noRep: boolean; lostBeforeStart: number | null;
  leftHooks: number | null; voided: number | null; voidAfterHooks: number | null; voidAtLoss: boolean; voidOk: boolean;
  startIn: 'clip' | 'replay' | null; pressIn: 'clip' | 'replay' | null; pressClip: number | null;
  settled: number; descent: number; stop: number; pauseEnd: number; backUpEye: number | null; delay: number | null;
  early: boolean; within1: boolean; within15: boolean; over15: boolean; startEarly: boolean; rackEarly: boolean;
  backPhone: boolean; backEye: boolean; backAgree: boolean;
  sink: number | null; sinking: boolean; refSink: number | null; refSinking: boolean;
  waits: { what: string; at: number; s: number; got: boolean; from: number; to: number; still: boolean }[]; log: string[];
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

/** Whether the reference bar stays within STILL_REF of the frame over [a, b] (clip ms). */
function refStill(ref: Ref, a: number, b: number): boolean {
  const w = ref.y.filter((y, k) => ref.t[k] * 1000 >= a && ref.t[k] * 1000 <= b && Number.isFinite(y));
  return w.length >= 3 && (Math.max(...w) - Math.min(...w)) / ref.h <= STILL_REF;
}

export function score(rules: Rel = RULES, tracesDir = join(HERE, 'data', 'traces')) {
  const eye: Record<string, Eye> = JSON.parse(readFileSync(join(HERE, 'data', 'eyetimes.json'), 'utf8'));
  const rows: Row[] = [];
  const files = readdirSync(tracesDir).filter(f => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  for (const f of files) {
    const pj = JSON.parse(readFileSync(join(tracesDir, f), 'utf8'));
    const id: string = pj.id; const e = eye[id]; if (!e) continue;
    const rj = JSON.parse(readFileSync(join(HERE, 'data', 'reference', `${id}.json`), 'utf8'));
    const ref: Ref = { t: rj.t, y: rj.y.map((y: number | null) => (y == null ? NaN : y)), h: rj.h };
    const group = e.grp === 'meet' ? 'meet' : BOUNCED.some(b => id.startsWith(b)) ? 'bounced' : 'paused';
    const pts: number[][] = pj.pts;
    const step = (pts.at(-1)![0] - pts[0][0]) / (pts.length - 1);
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
      const c = new BenchCaller({ x: pj.mark.x, y: pj.mark.y }, { w: pj.w, h: pj.h }, rules, pj.racked);
      const ct: Record<string, number> = {}, ctClip: Record<string, number> = {}, inHold: Record<string, boolean> = {};
      let late = false, noRep = false, voided: number | null = null, off = 0, holding: string | null = null;
      const log: string[] = [], fed: { t: number; y: number }[] = [], waits: Row['waits'] = [];
      let state1: string | null = null, state2: string | null = null;
      const feed = (t: number, clip: number, x: number, y: number, sc: number) => {
        if (sc >= rules.lostScore) fed.push({ t, y });
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
      return { c, ct, ctClip, inHold, late, noRep, voided, log, fed, waits, state1, state2 };
    };
    const holds: Hold[] = [];
    let r = run(holds);
    if (r.state1 === 'racked' || r.state1 === 'waiting') {
      const lo = Math.max(e.settled * 1000, cut1 - HOLD_MS);
      holds.push({ what: 'start', ...(process.env.STILL_START === '1' ? stillStretch(ref, e.settled * 1000, cut1) : { from: lo, to: cut1, still: refStill(ref, lo, cut1) }) });
      r = run(holds);
    }
    if (r.state2 === 'lifting') { holds.push({ what: 'press', ...stillStretch(ref, e.stop * 1000, cut2) }); r = run(holds); }
    const { c, ct, ctClip, inHold, late, noRep, voided, log, fed, waits } = r;

    const sh = (sec: number | null) => (sec == null ? null : sec + waits.filter(w => w.at < sec).reduce((a, w) => a + w.s, 0));
    const E = { settled: e.settled, descent: sh(e.descent)!, stop: sh(e.stop)!, pauseEnd: sh(e.pauseEnd)!, backUp: sh(e.backUp) };
    // Press! while sinking: after Press!, the bar goes more than 1% of the frame lower before it rises (3-frame median),
    // on the phone's trace (as fed, replay included) and, when Press! came in the clip, on the reference trace.
    const sink = ct.press != null ? sinkAfter(fed.map(q => ({ t: q.t / 1000, y: q.y })), ct.press, 0.01) : null;
    const pressIn = ct.press == null ? null : inHold.press ? 'replay' : 'clip';
    const refPts = ref.t.map((t, k) => ({ t, y: ref.y[k] / ref.h })).filter(q => Number.isFinite(q.y));
    const refSink = pressIn === 'clip' ? sinkAfter(refPts, ctClip.press, 0.01) : null;
    const delay = ct.press != null ? ct.press - E.stop : null;
    const backPhone = c.reachedTop && ct.press != null && ct.rack != null && !noRep && voided == null;
    // A missed Start! is safe only if the void comes: Rack! within voidMs (one frame's slack) of leaving the hooks, or at the loss.
    const leftHooks = c.leftAt == null ? null : c.leftAt / 1000, lostAt = c.lostBeforeStart == null ? null : c.lostBeforeStart / 1000;
    const voidAfterHooks = voided != null && leftHooks != null ? +(voided - leftHooks).toFixed(3) : null;
    const voidAtLoss = voided != null && voided === lostAt;
    const voidOk = voided != null && ((voidAfterHooks != null && voidAfterHooks <= (rules.voidMs + step) / 1000 + 1e-9) || voidAtLoss);
    const backEye = E.backUp != null;
    rows.push({
      id, group, inHand: !pj.racked, start: ct.start ?? null, press: ct.press ?? null, late, rack: ct.rack ?? null, noRep,
      lostBeforeStart: lostAt, leftHooks, voided, voidAfterHooks, voidAtLoss, voidOk,
      startIn: ct.start == null ? null : inHold.start ? 'replay' : 'clip', pressIn, pressClip: ctClip.press ?? null,
      settled: E.settled, descent: E.descent, stop: E.stop, pauseEnd: E.pauseEnd, backUpEye: E.backUp, delay,
      early: delay != null && delay < 0, within1: delay != null && delay >= 0 && delay <= 1, within15: delay != null && delay >= 0 && delay <= 1.5,
      over15: delay != null && delay > 1.5 && !late,
      startEarly: ct.start != null && ct.start < E.settled,
      rackEarly: ct.rack != null && (E.backUp == null ? !noRep : ct.rack < E.backUp),
      backPhone, backEye, backAgree: backPhone === backEye,
      sink, sinking: sink != null && sink > 0.01, refSink, refSinking: refSink != null && refSink > 0.01, waits, log,
    });
  }
  const scored = rows.filter(r => r.group !== 'bounced'), n = scored.length;
  const ids = (l: Row[]) => (l.length ? l.map(r => r.id.slice(0, 4)).join(', ') : 'none');
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
        noStart.map(r => `${r.id.slice(0, 4)} void ${r.voidAfterHooks?.toFixed(2) ?? '-'} s after leaving the hooks${r.voidAtLoss ? ' (at the loss)' : ''}${r.voidOk ? '' : ' (NOT OK)'}`).join('; '),
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
  const { rows, lines, notes } = score({ ...RULES, ...o }, process.argv[3]);
  const f2 = (x: number | null) => (x == null ? '-' : x.toFixed(2));
  const pc = (x: number | null) => (x == null ? '-' : `${(100 * x).toFixed(1)}%`);
  if (process.env.QUIET !== '1') for (const r of rows) {
    console.log(`${r.id.slice(0, 5).padEnd(5)} ${r.group.padEnd(7)} ${r.inHand ? 'hand' : 'rack'} ${r.log.join(', ').padEnd(46)}| settled ${f2(r.settled)} descent ${f2(r.descent)} stop ${f2(r.stop)} rose ${f2(r.pauseEnd)} back up ${f2(r.backUpEye)}` +
      ` | Start! in ${r.startIn ?? '-'}, Press! in ${r.pressIn ?? '-'}, Press!-stop ${f2(r.delay)} sink ${pc(r.sink)} ref ${pc(r.refSink)}` +
      `${r.waits.length ? ' | waits ' + r.waits.map(w => `${w.what} ${w.s.toFixed(2)} s on ${w.from.toFixed(2)}-${w.to.toFixed(2)}${w.still ? '' : ' (not still)'}${w.got ? '' : ' (none)'}`).join(', ') : ''}` +
      `${r.lostBeforeStart != null ? ` | lost before Start! at ${f2(r.lostBeforeStart)}` : ''}${r.start == null ? ` | off the hooks ${f2(r.leftHooks)}, void ${f2(r.voided)}` : ''}`);
  }
  for (const l of Object.values(lines)) console.log(`${l.text} -> ${l.status}`);
  console.log(notes.holds);
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ rules: { ...RULES, ...o }, lines, notes, rows }, null, 1) + '\n');
}
