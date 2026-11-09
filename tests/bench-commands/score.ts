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

type Eye = { grp: string; settled: number; descent: number; stop: number; pauseEnd: number; backUp: number | null };
export type Row = {
  id: string; group: 'meet' | 'paused' | 'bounced'; inHand: boolean;
  start: number | null; press: number | null; late: boolean; rack: number | null; noRep: boolean; lostBeforeStart: number | null;
  settled: number; descent: number; stop: number; pauseEnd: number; backUpEye: number | null; delay: number | null;
  early: boolean; within1: boolean; within15: boolean; over15: boolean; startEarly: boolean; rackEarly: boolean;
  backPhone: boolean; backEye: boolean; backAgree: boolean; sink: number | null; sinking: boolean;
  waits: { what: string; at: number; s: number; got: boolean }[]; log: string[];
};

export function score(rules: Rel = RULES, tracesDir = join(HERE, 'data', 'traces')) {
  const eye: Record<string, Eye> = JSON.parse(readFileSync(join(HERE, 'data', 'eyetimes.json'), 'utf8'));
  const rows: Row[] = [];
  const files = readdirSync(tracesDir).filter(f => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  for (const f of files) {
    const pj = JSON.parse(readFileSync(join(tracesDir, f), 'utf8'));
    const id: string = pj.id; const e = eye[id]; if (!e) continue;
    const group = e.grp === 'meet' ? 'meet' : BOUNCED.some(b => id.startsWith(b)) ? 'bounced' : 'paused';
    const c = new BenchCaller({ x: pj.mark.x, y: pj.mark.y }, { w: pj.w, h: pj.h }, rules, pj.racked);
    const ct: Record<string, number> = {}; let late = false, noRep = false; const log: string[] = [];
    const dbg = process.env.DEBUG && id.startsWith(process.env.DEBUG);
    // She waits for each command. The lifters in these clips followed a real referee, not this phone, so if the phone
    // hasn't called Start! by the eye's descent (less 0.1 s), or Press! by the moment she rose from the bottom, the bar is
    // held there: the last 0.4 s of the hold plays back and forth until the command comes, plus 0.3 s to react, at most
    // 3 s. Every later time, by eye and by phone, moves by the wait.
    const pts: number[][] = pj.pts;
    const step = (pts.at(-1)![0] - pts[0][0]) / (pts.length - 1);
    const fed: number[][] = []; const waits: Row['waits'] = [];
    let off = 0;
    const feed = (t: number, x: number, y: number, sc: number) => {
      fed.push([t, x, y, sc]);
      const cmd = c.feed(t, x, y, sc);
      if (dbg) console.log(`   ${(t / 1000).toFixed(2)} ${c.state} y ${y.toFixed(3)} sc ${sc.toFixed(2)} v ${c.speeds.at(-1)?.v.toFixed(3) ?? '-'}`);
      if (cmd) {
        if (ct[cmd.cmd] === undefined) ct[cmd.cmd] = cmd.t / 1000;
        if (cmd.late) late = true; if (cmd.noRep) noRep = true;
        log.push(`${cmd.cmd}${cmd.late ? '(late)' : ''}${cmd.noRep ? '(no rep)' : ''} ${(cmd.t / 1000).toFixed(2)}`);
      }
    };
    const hold = (what: string, i: number, from: number) => {
      const seg = pts.slice(0, i).filter(q => q[0] >= from);
      if (seg.length < 2) return;
      const loop = [...seg, ...seg.slice(1, -1).reverse()];
      const base = pts[i][0] + off; let k = 0, gotAt = -1;
      while (k * step < 3000) {
        if (ct[what] !== undefined && gotAt < 0) gotAt = k;
        if (gotAt >= 0 && (k - gotAt) * step >= 300) break;
        const q = loop[k % loop.length]; feed(base + k * step, q[1], q[2], q[3]); k++;
      }
      waits.push({ what, at: pts[i][0] / 1000, s: +((k * step) / 1000).toFixed(3), got: ct[what] !== undefined }); off += k * step;
    };
    const cut1 = (e.descent - 0.1) * 1000, cut2 = e.pauseEnd * 1000; let did1 = false, did2 = false;
    for (let i = 0; i < pts.length; i++) {
      const [t, x, y, sc] = pts[i];
      if (!did1 && t >= cut1) { did1 = true; if (c.state === 'racked' || c.state === 'waiting') hold('start', i, Math.max(e.settled * 1000, cut1 - 400)); }
      if (!did2 && t >= cut2) { did2 = true; if (c.state === 'lifting') hold('press', i, Math.max(e.stop * 1000, cut2 - 400)); }
      feed(t + off, x, y, sc);
    }
    const sh = (sec: number | null) => (sec == null ? null : sec + waits.filter(w => w.at <= sec + 0.05).reduce((a, w) => a + w.s, 0));
    const E = { settled: e.settled, descent: sh(e.descent)!, stop: sh(e.stop)!, pauseEnd: sh(e.pauseEnd)!, backUp: sh(e.backUp) };
    // Press! while sinking: after Press!, the bar goes more than 1% of the frame lower before it rises (3-frame median).
    let sink: number | null = null;
    if (ct.press != null) {
      const seen = fed.filter(q => q[3] >= rules.lostScore);
      const ys = seen.map((_, i) => { const w = seen.slice(Math.max(0, i - 1), i + 2).map(q => q[2]).sort((a, b) => a - b); return w[Math.floor(w.length / 2)]; });
      const i0 = seen.findIndex(q => q[0] / 1000 >= ct.press);
      if (i0 >= 0) {
        let mx = ys[i0];
        for (let i = i0; i < seen.length; i++) { mx = Math.max(mx, ys[i]); if (ys[i] < mx - 0.01) break; }
        sink = mx - ys[i0];
      }
    }
    const delay = ct.press != null ? ct.press - E.stop : null;
    const backPhone = c.reachedTop && ct.press != null && ct.rack != null && !noRep;
    const backEye = E.backUp != null;
    rows.push({
      id, group, inHand: !pj.racked, start: ct.start ?? null, press: ct.press ?? null, late, rack: ct.rack ?? null, noRep,
      lostBeforeStart: c.lostBeforeStart == null ? null : c.lostBeforeStart / 1000,
      settled: E.settled, descent: E.descent, stop: E.stop, pauseEnd: E.pauseEnd, backUpEye: E.backUp, delay,
      early: delay != null && delay < 0, within1: delay != null && delay >= 0 && delay <= 1, within15: delay != null && delay >= 0 && delay <= 1.5,
      over15: delay != null && delay > 1.5 && !late,
      startEarly: ct.start != null && ct.start < E.settled,
      rackEarly: ct.rack != null && (E.backUp == null ? !noRep : ct.rack < E.backUp),
      backPhone, backEye, backAgree: backPhone === backEye, sink, sinking: sink != null && sink > 0.01, waits, log,
    });
  }
  const scored = rows.filter(r => r.group !== 'bounced'), n = scored.length;
  const ids = (l: Row[]) => (l.length ? l.map(r => r.id.slice(0, 4)).join(', ') : 'none');
  const sinkOrEarly = scored.filter(r => r.sinking || r.early);
  const w1 = scored.filter(r => r.within1), w15 = scored.filter(r => r.within15), o15 = scored.filter(r => r.over15);
  const sE = rows.filter(r => r.startEarly), rE = rows.filter(r => r.rackEarly), bD = scored.filter(r => !r.backAgree);
  const lines = {
    line1: { pass: !sinkOrEarly.length, text: `1. No Press! while the bar is still going down (more than 1% of the frame lower after Press!, 3-frame median), ${n} reps: ${sinkOrEarly.length} (${ids(sinkOrEarly)})` },
    line2: { pass: w1.length >= 0.9 * n && !o15.length, text: `2. Press! within 1 s of the stop on at least 90%: ${w1.length} of ${n}; past 1.5 s and not late: ${o15.length} (${ids(o15)}). Within 1.5 s: ${w15.length} of ${n}` },
    line3: { pass: !sE.length, text: `3. No Start! before the bar settled, all ${rows.length} reps: ${sE.length} early (${ids(sE)}). No Start!: ${ids(rows.filter(r => r.start == null))}` },
    line4: { pass: !rE.length, text: `4. No Rack! before the bar is back up, all ${rows.length} reps: ${rE.length} early (${ids(rE)})` },
    line5: { pass: !bD.length, text: `5. "Back up" agrees with the eye, ${n} reps: ${n - bD.length} of ${n} (disagree: ${ids(bD)})` },
  };
  return { rows, lines, n };
}

if (process.argv[1]?.endsWith('score.ts')) {
  const o = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : {};
  const { rows, lines } = score({ ...RULES, ...o }, process.argv[3]);
  const f2 = (x: number | null) => (x == null ? '-' : x.toFixed(2));
  if (process.env.QUIET !== '1') for (const r of rows) {
    console.log(`${r.id.slice(0, 5).padEnd(5)} ${r.group.padEnd(7)} ${r.inHand ? 'hand' : 'rack'} ${r.log.join(', ').padEnd(46)}| settled ${f2(r.settled)} descent ${f2(r.descent)} stop ${f2(r.stop)} rose ${f2(r.pauseEnd)} back up ${f2(r.backUpEye)}` +
      ` | Press!-stop ${f2(r.delay)} sink ${f2(r.sink)}${r.waits.length ? ' | waits ' + r.waits.map(w => `${w.what} ${w.s.toFixed(2)} s${w.got ? '' : ' (none)'}`).join(', ') : ''}${r.lostBeforeStart != null ? ` | lost before Start! at ${f2(r.lostBeforeStart)}` : ''}`);
  }
  for (const l of Object.values(lines)) console.log(`${l.text} -> ${l.pass ? 'PASS' : 'FAIL'}`);
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ rules: { ...RULES, ...o }, lines, rows }, null, 1) + '\n');
}
