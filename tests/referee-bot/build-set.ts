// The referee bot test's set (plan 3.4d step 11, item 107): every clip with by-eye calls, each cut as the attempt
// the bot would get. It writes calls.json, which both recut.py (clip, window, commands, moments, bench) and run.ts
// (lift, division, weight, reason, measures, command_times, call) read, and holdout.json.
//
// Each attempt goes through the product's own code: the bench's measures from measureBar on its plate path, the
// other lifts' commands from the phone's own MeetLift on the worker's poses, their moments and close-call reason
// from judgeAttempt as the frames job takes them, and the burned-in words from commandList and benchBlock.
// Every time in an attempt is from its window's start, as if the phone had filmed only that stretch.
//
// Usage (from the repo root):
//   TSX_TSCONFIG_PATH=web/tsconfig.json npx tsx tests/referee-bot/build-set.ts --poses <worker poses dir> \
//     [--out tests/referee-bot] [--seed 1]
// The poses folder holds the worker's poses (worker/cli.py --fps 15) of each squat, deadlift, press and sample clip,
// named <clip>.json. The bench data is in tests/bench-commands/data, the eye's other calls in tests/referee-bot/data.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { markStuck, measureBar, type BarPoint } from '../../web/lib/judge/bar-measure';
import { MeetLift, type MeetLiftName } from '../../web/lib/judge/meet-lift';
import { judgeAttempt, checkCommandTimes, type MeetLift as JudgeLift } from '../../web/lib/judge/attempt';
import { commandList, benchBlock } from '../../web/lib/referee/bot';
import { camera, eyePauses, plant } from './pauses';
import type { Frame } from '../../web/lib/judge/pose';

const ROOT = join(__dirname, '../..');
const BENCH = join(ROOT, 'tests/bench-commands/data');
const DATA = join(__dirname, 'data');
/** 3.10: the recording stops 1.5 s after "Rack!" / "Down!". */
const AFTER_END_MS = 1500;

export type Group = 'bench white' | 'bench red' | 'press' | 'squat and deadlift' | 'close calls';
export type Attempt = {
  id: string; group: Group; source: string; cut: 'one' | 'lost' | 'stuck' | 'planted' | null;
  // score.py prints a recorded row's lamps and counts it in no line (item 113's planted cuts)
  recorded?: boolean;
  // recut.py
  clip: string; free: boolean; window_ms: [number, number]; commands: [number, string][];
  moments: { ms: number; flagged: boolean }[]; bench: ReturnType<typeof benchBlock>;
  // run.ts
  lift: 'squat' | 'bench' | 'deadlift'; division: 'barbell' | 'home'; weight: number; units: 'kg' | 'lb';
  reps_declared: number | null; reason: string; measures: Record<string, unknown> | null;
  command_times: Record<string, number | string>; call: string; eye_pause_s?: number | null;
  note?: string;
};

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}
const json = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8'));
const r3 = (s: number) => Math.round(s * 1000);
/** One frame at the server's 15 fps, in ms. */
const SERVER_FRAME_MS = 67;
const sure = (call: string) => call !== 'either';

// ---------- the bench ----------

export type Trace = { w: number; h: number; pts: BarPoint[] };
type Rep = { descent: number; stop: number; end: number; backUp: number | null; call: string };

/** A track's points in the window, from its start. */
function pathIn(pts: BarPoint[], w0: number, w1: number): BarPoint[] {
  return pts.filter(([t]) => t >= w0 && t <= w1).map(([t, x, y, s]) => [t - w0, x, y, s]);
}

/**
 * One bench cut. `ct` holds the clip's own times in s (keys loaded, start, press | press_late, rack); the window
 * is [w0, w1] in s. `server` is the server's track of the clip (tests/bench-commands/server.py, as one_bar makes it
 * from the trace's own tap). Returns the attempt's recut and run fields, every time from the window's start.
 */
function benchCut(tr: Trace, server: BarPoint[], w0s: number, w1s: number, ct: Record<string, number>, lostAt: number | null) {
  const w0 = r3(w0s), w1 = r3(w1s);
  const rel: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(ct)) rel[k] = r3(v) - w0;
  if (lostAt !== null) rel.press_late_why = 'lost';
  // a Rack! the rules put past the cut's end goes at its last moment, in both cuts, so no time is outside_clip
  // (item 107, The Playner, Nov 15, 11:41 PM; in a meet the phone films 1.5 s past Rack!, so this never happens there),
  // one server frame inside, so a recut a frame short doesn't round it outside (NerdCider, 11:42 PM)
  if (typeof rel.rack === 'number' && rel.rack > w1 - w0 - SERVER_FRAME_MS) rel.rack = w1 - w0 - SERVER_FRAME_MS;
  const times = Object.fromEntries(Object.entries(rel).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
  // as takeBar: broken command times make it a `command_times` close call, with nothing measured
  const problem = checkCommandTimes(rel as never, 'bench', w1 - w0);
  // as takeBar (3.4d step 11, items 108 and 110): the phone's own path (the trace, as the phone followed it live), its
  // stuck stretches inside Start!-Rack! marked lost, then measured: the Pause line comes from the path the commands
  // came from. On the lost-track cut `press_late_why: lost` keeps the pause unmeasured.
  const phone = markStuck(pathIn(tr.pts, w0, w1), rel as never);
  const measures = problem ? { command_times: problem } : { ...measureBar(phone.path, rel as never, { w: tr.w, h: tr.h }), stuck: phone.stuck };
  // the frames still find the touch on the server's guarded track (test_touch.py's numbers are on it)
  const { path } = problem ? { path: pathIn(server, w0, w1) } : markStuck(pathIn(server, w0, w1), rel as never);
  return {
    // as framesJob: the saved path goes with it, and the frames find the touch from it first
    window_ms: [w0, w1] as [number, number], command_times: rel, commands: commandList(times), bench: benchBlock(rel, { path }),
    moments: [], measures: measures as unknown as Record<string, unknown>, reason: problem ? 'command_times' : 'bench_referee',
  };
}

/** The gym reps' eye times: rep 1 from eyetimes.json; the others from the plate trace, by the 10% rule. */
function gymReps(id: string, tr: Trace, start0: number, reps: [number, number, string][], eye: Record<string, Eye>): Rep[] {
  const out: Rep[] = [];
  let prev = start0;
  reps.forEach(([stop, end, call], i) => {
    const seg = tr.pts.filter(q => q[0] / 1000 >= prev && q[0] / 1000 <= stop && q[3] >= 0.5);
    const top = Math.min(...seg.map(q => q[2])), low = Math.max(...seg.map(q => q[2]));
    const near = seg.filter(q => q[2] <= top + 0.1 * (low - top));
    const up = tr.pts.find(q => q[0] / 1000 > end && q[3] >= 0.5 && q[2] <= top + 0.1 * (low - top));
    const e = i === 0 ? eye[id] : undefined;
    out.push({
      descent: e?.descent ?? (near.length ? near[near.length - 1][0] / 1000 : prev),
      stop, end, call,
      backUp: e ? e.backUp ?? (up ? up[0] / 1000 : null) : up ? up[0] / 1000 : null,
    });
    prev = end;
  });
  return out;
}

type Eye = { grp: string; call: string; start: [number, number]; descent: number; stop: number; pauseEnd: number; backUp: number | null };
type MeetCall = { id: string; clip: string; start: [number, number]; reps: [number, number, string][]; note?: string };
type GymCall = { id: string; start: [number, number]; reps: [number, number, string][]; note?: string };

/** Per-attempt weights the clip names (title or card); every other bench gets a weight that fits the lift. */
const BENCH_WEIGHT: Record<string, number> = { ak3m2: 175, ak3m3: 182.5 };
/**
 * Press! 0.2 s before the eye's pause end, never before the bar stops (item 107, The Playner, Nov 15, 11:41 PM):
 * by the eye's pause end the bar has started up, so measureBar would find no pause. A real referee calls on a still bar.
 * Cut 1 only: the lost-track cut's Press! is its own late one. `--press-lead` (s) is for trying another lead.
 */
const PRESS_LEAD = Number(arg('press-lead') ?? 0.2);
const pressAt = (stop: number, end: number) => Math.max(stop, end - PRESS_LEAD);
const MEET_BENCH_KG = 100;
const GYM_BENCH_KG = 60;

/**
 * The bench attempts. `opts.trace` may change each clip's phone trace before it's cut (test_pause.py's planted frames
 * and slower cameras, through pauses.ts); the server's tracks are never changed.
 */
export function benchAttempts(opts: { trace?: (id: string, tr: Trace) => Trace } = {}): { attempts: Attempt[]; left_out: { id: string; why: string }[] } {
  const eye = json<Record<string, Eye>>(join(BENCH, 'eyetimes.json'));
  const read = (id: string) => json<Trace>(join(BENCH, 'traces', `${id}.json`));
  const trace = (id: string) => (opts.trace ? opts.trace(id, read(id)) : read(id));
  const server = (id: string) => json<BarPoint[]>(join(BENCH, 'server', `${id}.json`));
  const attempts: Attempt[] = [];
  const left_out: { id: string; why: string }[] = [];
  const base = { lift: 'bench' as const, division: 'barbell' as const, units: 'kg' as const, reps_declared: null, reason: 'bench_referee', free: false };

  // the meet attempts: Start! at the end of the eye's Start! window, Press! at its pause end, Rack! 0.3 s after
  // back-up; each cut from 1.0 s before Start! to 1.0 s after Rack!
  for (const m of json<{ attempts: MeetCall[] }>(join(BENCH, 'calls-meet.json')).attempts) {
    const e = eye[m.id];
    const tr = trace(m.id), sv = server(m.id);
    const [stop, end, call] = m.reps[0];
    const clip = `meet/${m.clip.split(' ')[0]}.mp4`;
    const backUp = e.backUp ?? end + 1.0;
    const start = m.start[1];
    const group: Group = call.startsWith('red') ? 'bench red' : 'bench white';
    const one = { start, press: pressAt(stop, end), rack: backUp + 0.3 };
    attempts.push({
      id: m.id, group, source: m.clip.split(' ')[0], cut: 'one', clip, ...base, weight: BENCH_WEIGHT[m.id] ?? MEET_BENCH_KG,
      call, eye_pause_s: +(end - stop).toFixed(2),
      ...benchCut(tr, sv, start - 1.0, one.rack + 1.0, { loaded: start - 1.0, ...one }, null),
    });
    if (!sure(call)) continue;
    // lost at the descent; Press! 2 s later; Rack! 3 s after that, or at back-up if sooner
    if (m.id === 'AMih') { left_out.push({ id: 'AMih-lost', why: 'Rack! comes 1.47 s before her lockout, so the cut has no lockout (The Playner, 11:20 PM)' }); continue; }
    const press = e.descent + 2;
    const rack = Math.min(press + 3, e.backUp ?? Infinity);
    attempts.push({
      id: `${m.id}-lost`, group, source: m.clip.split(' ')[0], cut: 'lost', clip, ...base, weight: BENCH_WEIGHT[m.id] ?? MEET_BENCH_KG,
      call, eye_pause_s: +(end - stop).toFixed(2),
      ...benchCut(tr, sv, start - 1.0, rack + 1.0, { loaded: start - 1.0, start, press_late: press, rack }, e.descent),
    });
  }

  // the gym reps: each sure rep its own attempt, one rep a cut (The Playner, 11:20 PM)
  for (const g of json<{ attempts: GymCall[] }>(join(BENCH, 'calls-run1.json')).attempts) {
    const tr = trace(g.id), sv = server(g.id);
    // the cuts come from the trace as recorded, so a changed trace (opts.trace) never moves a command
    const reps = gymReps(g.id, read(g.id), g.start[0], g.reps, eye);
    const group: Group = reps.some(r => r.call.startsWith('red')) ? 'bench red' : 'bench white';
    reps.forEach((r, i) => {
      if (!sure(r.call)) return;
      const prev = reps[i - 1], next = reps[i + 1];
      const id = `${g.id.slice(0, 4)}-r${i + 1}`;
      const start = Math.max(r.descent - 0.5, prev?.backUp ?? -Infinity);
      const w0 = Math.max(start - 1.0, prev?.end ?? -Infinity, 0);
      const lockout = r.backUp ?? r.end + 1.0;
      const rack = lockout + 0.3;
      const red = r.call.startsWith('red');
      const one: Record<string, number> = { loaded: w0, start, ...(red ? {} : { press: pressAt(r.stop, r.end) }), rack };
      const common = { group, source: g.id, clip: `bench/${g.id}.webm`, ...base, weight: GYM_BENCH_KG, call: r.call, eye_pause_s: +(r.end - r.stop).toFixed(2) };
      attempts.push({ id, cut: 'one', ...common, ...benchCut(tr, sv, w0, Math.min(rack + 1.0, next?.descent ?? Infinity), one, null),
        ...(r.backUp === null ? { note: 'no lockout found on the trace: Rack! 1.3 s after the pause end' } : {}) });
      const press = r.descent + 2;
      if (next && press > next.descent - 0.3) {
        left_out.push({ id: `${id}-lost`, why: `its Press! (${press.toFixed(2)} s) comes ${(press - next.descent + 0.3).toFixed(2)} s past 0.3 s before the next descent (${next.descent.toFixed(2)} s)` });
        return;
      }
      const lrack = press + 3;
      attempts.push({ id: `${id}-lost`, cut: 'lost', ...common,
        ...benchCut(tr, sv, w0, Math.min(lrack + 1.0, next?.descent ?? Infinity), { loaded: w0, start, press_late: press, rack: lrack }, r.descent) });
    });
  }

  // "Press! inside a stuck stretch" (3.4d step 11, item 108; VibeSearch, Nov 16, 2:23 AM): IA0P rep 3 with the calls
  // the phone's caller gives when the rep is played as its own attempt (Buildnanafest, 2:21 AM). The phone's own stick
  // calls Press! 0.23 s before the bar stops; the server's guarded track marks 16.53-17.53 s, so the pause isn't
  // measured and the stuck line shows. She rose after the call, so the answer is white on the pause: the eye's call is
  // "either", on a 0.30 s pause, and nothing else on the rep is red.
  {
    const id = 'IA0PhDBzsz0', tr = trace(id), sv = server(id);
    const calls = { start: 15.21, press: 16.82, rack: 18.89 };
    const dur = read(id).pts.at(-1)![0] / 1000;
    const w0 = calls.start - 1.0, w1 = Math.min(calls.rack + 1.0, dur);
    attempts.push({
      id: 'IA0P-r3-stuck', cut: 'stuck', group: 'bench white', source: id, clip: `bench/${id}.webm`, ...base, weight: GYM_BENCH_KG,
      call: 'white', eye_pause_s: +(17.35 - 17.05).toFixed(2),
      note: "the phone's caller's own calls on rep 3 (Press! 0.23 s before the stop); the eye's call is either, so white on the pause",
      ...benchCut(tr, sv, w0, w1, { loaded: w0, ...calls }, null),
    });
  }

  // the Commons bench demonstration: 3 "either" reps, free to commit (by eye, data/bench-demo.json)
  const bd = json<{ duration: number; reps: { descent: number | null; stop: number; end: number; backUp: number | null }[] }>(join(DATA, 'bench-demo.json'));
  bd.reps.forEach((r, i) => {
    const prev = bd.reps[i - 1], next = bd.reps[i + 1];
    // rep 1 opens mid-descent: Start! on the clip's first frames, just after "Bar is loaded.", as checkCommandTimes needs
    const start = Math.max((r.descent ?? 0) - 0.5, prev?.backUp ?? -Infinity, 0.1);
    const w0 = Math.max(start - 1.0, prev?.end ?? -Infinity, 0);
    const rack = r.backUp !== null ? r.backUp + 0.3 : bd.duration;
    const ct: Record<string, number> = { loaded: w0, start, press: pressAt(r.stop, r.end), rack };
    const w1 = Math.min(rack + 1.0, next?.descent ?? Infinity, bd.duration);
    const rel: Record<string, number> = Object.fromEntries(Object.entries(ct).map(([k, v]) => [k, r3(v) - r3(w0)]));
    // as benchCut: a Rack! at or past the cut's end goes one server frame inside it
    rel.rack = Math.min(rel.rack, r3(w1) - r3(w0) - SERVER_FRAME_MS);
    attempts.push({
      id: `bench-demo-r${i + 1}`, group: 'close calls', source: 'bench-demo', cut: 'one', clip: 'tests/clips/bench-demo.webm', ...base, free: true,
      weight: GYM_BENCH_KG, call: 'either', eye_pause_s: +(r.end - r.stop).toFixed(2),
      window_ms: [r3(w0), r3(w1)], command_times: rel, commands: commandList(rel), bench: benchBlock(rel), moments: [],
      reason: checkCommandTimes(rel, 'bench', r3(w1) - r3(w0)) ? 'command_times' : 'bench_referee',
      // the clip cuts between camera angles, so no plate path is measured: the bot gets the pause by eye
      measures: null,
    });
  });
  return { attempts, left_out };
}

// ---------- the squat, deadlift and press: the phone's own calls on the worker's poses ----------

type Poses = { w: number; h: number; duration: number; frames: Frame[] };

/**
 * The phone's commands on one stretch: MeetLift (the spot taken as right, as the judge tests have it) fed from
 * `from` (ms). The window runs from "Bar is loaded." / "Weights ready." to 1.5 s after the end command, or to `until`.
 * Then the frames job's moments and the judge's call on the window, exactly as framesJob takes them.
 */
export function phoneCut(p: Poses, lift: MeetLiftName, reps: number | null, from: number, until: number, ctStored?: Record<string, number>) {
  let w0: number | null = null;
  let ct: Record<string, number> = {};
  let endAt: number | null = null;
  if (ctStored) { w0 = from; ct = { ...ctStored }; endAt = (ctStored.rack ?? ctStored.down ?? until - from) + from; }
  else {
    const ml = new MeetLift({ w: p.w, h: p.h }, lift, { reps, skipFrameCheck: true });
    for (const f of p.frames) {
      if (f.t < from || f.t > until) continue;
      for (const ev of ml.feed(f)) {
        if (ev.type === 'loaded') { w0 = ev.t; ct.loaded = 0; }
        else if (w0 !== null && (ev.type === 'call' || ev.type === 'rep')) ct[ev.key] = ev.t - w0;
        else if (w0 !== null && ev.type === 'end') { ct[ev.key] = ev.t - w0; endAt = ev.t; }
      }
      if (endAt !== null) break;
    }
  }
  if (w0 === null) return null;
  const w1 = Math.min(endAt !== null ? endAt + AFTER_END_MS : until, until, Math.round(p.duration * 1000));
  // with no end command before the stretch ends, the end goes at its last frame (as a Home set's 90 s cap does)
  if (endAt === null) ct[lift === 'deadlift' ? 'down' : 'rack'] = w1 - w0;
  const frames = p.frames.filter(f => f.t >= w0! && f.t <= w1).map(f => ({ ...f, t: f.t - w0! }));
  const v = judgeAttempt(frames, { w: p.w, h: p.h, duration: (w1 - w0) / 1000 }, lift as JudgeLift, ct as never, undefined, reps);
  const moments: { ms: number; flagged: boolean }[] = [];
  for (const r of v.result?.reps ?? []) {
    const flagged = r.call.light !== 'white';
    for (const ms of [r.judgedFrameMs, r.endMs, (r as { pressMs?: number }).pressMs]) if (typeof ms === 'number') moments.push({ ms, flagged });
  }
  if (v.judgedFrameMs !== null) moments.push({ ms: v.judgedFrameMs, flagged: true });
  // the product's own reason: a close call's (command_times included); judge_unavailable is what the test sends otherwise
  const closeReason = v.call.light === 'close' && v.call.reason !== 'judge_unavailable' ? v.call.reason : null;
  return {
    window_ms: [w0, w1] as [number, number], command_times: ct, commands: commandList(ct), bench: null, moments,
    // a close call keeps the judge's reason and its measures; otherwise judge_unavailable, with no measured lines
    reason: closeReason ?? 'judge_unavailable', measures: closeReason ? v.measures : null,
    judge: v.call.light === 'close' ? `close:${v.call.reason}` : v.call.light === 'red' ? `red:${v.call.reason}` : 'white',
  };
}

type PressCall = { id: string; take?: number; group: string; win?: [number, number]; start: [number, number]; reps: [number, number, string, number?][]; note?: string };
type OtherCall = {
  id: string; source: string; clip: string; free: boolean; poses: string; group: Group; lift: MeetLiftName; division: 'barbell' | 'home';
  weight: number; reps_declared: number | null; from_s: number; until_s: number; call: string; command_times?: Record<string, number>; note?: string;
};

export function otherAttempts(posesDir: string): { attempts: Attempt[]; left_out: { id: string; why: string }[]; judged: Record<string, string> } {
  const attempts: Attempt[] = [];
  const left_out: { id: string; why: string }[] = [];
  const judged: Record<string, string> = {};
  const poses = new Map<string, Poses>();
  const posesOf = (id: string) => {
    if (!poses.has(id)) {
      const f = join(posesDir, `${id}.json`);
      if (!existsSync(f)) throw new Error(`no worker poses for ${id} in ${posesDir}`);
      poses.set(id, json<Poses>(f));
    }
    return poses.get(id)!;
  };
  const add = (o: OtherCall) => {
    const c = phoneCut(posesOf(o.poses), o.lift, o.reps_declared, r3(o.from_s), r3(o.until_s), o.command_times);
    if (!c) { left_out.push({ id: o.id, why: 'the phone never said the soft command on its stretch' }); return; }
    const { judge, ...cut } = c;
    judged[o.id] = judge;
    attempts.push({
      id: o.id, group: o.group, source: o.source, cut: null, clip: o.clip, free: o.free, lift: o.lift === 'bench' ? 'bench' : o.lift,
      division: o.division, weight: o.weight, units: 'kg', reps_declared: o.reps_declared, call: o.call, ...cut,
      ...(o.note ? { note: o.note } : {}),
    });
  };

  // the overhead press sets (3.4c's third run), judged as Home sets of the reps the eye counted
  for (const a of json<{ attempts: PressCall[] }>(join(DATA, 'press-calls.json')).attempts) {
    const calls = a.reps.map(r => r[2]);
    const call = calls.includes('red') ? 'red:no_lockout' : calls.every(c => c === 'white') ? 'white' : 'either';
    const p = posesOf(a.id);
    add({
      id: `${a.id.slice(0, 4)}${a.take ? `-t${a.take}` : ''}`, source: a.id, clip: `press/${a.id}.webm`, free: false, poses: a.id, group: 'press',
      lift: 'bench', division: 'home', weight: 20, reps_declared: a.reps.length,
      from_s: a.win?.[0] ?? Math.max(0, a.start[0] - 3), until_s: a.win?.[1] ?? p.duration, call,
    });
  }
  const sd = json<{ attempts: OtherCall[]; left_out?: { id: string; why: string }[] }>(join(DATA, 'squat-deadlift.json'));
  for (const o of sd.attempts) add(o);
  left_out.push(...(sd.left_out ?? []));
  return { attempts, left_out, judged };
}

// ---------- the held-back third ----------

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A third of the clips in each group, rounded up, by a seeded shuffle; all of a clip's attempts go together.
 * At least 2 sure reds are held back, or the next seed is taken.
 */
export function holdout(attempts: Attempt[], seed0: number) {
  const groups = new Map<Group, string[]>();
  for (const a of attempts) {
    const g = groups.get(a.group) ?? [];
    if (!g.includes(a.source)) g.push(a.source);
    groups.set(a.group, g);
  }
  for (let seed = seed0; seed < seed0 + 1000; seed++) {
    const rnd = mulberry32(seed);
    const held = new Set<string>();
    for (const [, clips] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const s = [...clips].sort();
      for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }
      for (const c of s.slice(0, Math.ceil(s.length / 3))) held.add(c);
    }
    const ids = attempts.filter(a => held.has(a.source)).map(a => a.id);
    const reds = attempts.filter(a => held.has(a.source) && a.call.startsWith('red')).length;
    if (reds >= 2) return { seed, clips: [...held].sort(), attempts: ids };
  }
  throw new Error('no seed holds back 2 sure reds');
}

/**
 * Item 113's two allowed misses, sent to the bot as recorded rows (3.4b, the smoothing test's "The lines"; VibeSearch
 * and The Playner, Nov 20, 10:01-10:03 AM): cut 1 of each as the phone sends it at 15 fps with one bad frame planted
 * in her pause, on the grid (all three ticks give the same line). The clip, window and commands are cut 1's, so the
 * frames are too; only the phone's path, and so the Pause line, differs. score.py reads their lamps, counts them in
 * no line, and a red for the pause on either goes to The Playner before the bot is switched on.
 */
export const PLANTED = [
  { id: 'ak3m3', dy: 0.05, why: 'sent 0.2 s on an eye pause of 0.50 s (0.05 lower)' },
  { id: '8qzW-r1', dy: -0.05, why: 'sent "still 0.0 s" on an eye pause of 0.67 s (0.05 higher)' },
] as const;
export function plantedAttempts(): Attempt[] {
  const pauses = eyePauses();
  const { attempts } = benchAttempts({ trace: (id, tr) => {
    const p = PLANTED.find(q => id.startsWith(q.id.slice(0, 4)));
    return p ? { ...tr, pts: plant(camera(tr.pts, 15), pauses[id] ?? [], p.dy) } : tr;
  } });
  return PLANTED.map(p => {
    const a = attempts.find(x => x.id === p.id && x.cut === 'one');
    if (!a) throw new Error(`${p.id}: no cut 1 to plant`);
    return { ...a, id: `${p.id}-planted`, cut: 'planted' as const, recorded: true,
      note: `item 113's allowed miss: at 15 fps, one frame planted in her pause, ${p.why}; recorded, counted in no line` };
  });
}

async function main() {
  const posesDir = arg('poses');
  if (!posesDir) throw new Error('--poses is needed');
  const out = arg('out') ?? __dirname;
  const b = benchAttempts();
  const o = otherAttempts(posesDir);
  const attempts = [...b.attempts, ...plantedAttempts(), ...o.attempts];
  const ids = new Set<string>();
  for (const a of attempts) { if (ids.has(a.id)) throw new Error(`two attempts are ${a.id}`); ids.add(a.id); }
  // every bench goes out with its bench lines: none may become a `command_times` close call (NerdCider, 11:42 PM)
  const broken = attempts.filter(a => a.lift === 'bench' && a.division === 'barbell' && a.reason === 'command_times');
  if (broken.length) throw new Error(`benches sent as command_times: ${broken.map(a => `${a.id} (${JSON.stringify(a.measures)})`).join(', ')}`);
  writeFileSync(join(out, 'calls.json'), JSON.stringify({
    $comment: 'The referee bot test set (plan 3.4d step 11), written by build-set.ts. The by-eye calls are the answer key: written before any run and never changed after. Times are ms from each window\'s start.',
    left_out: [...b.left_out, ...o.left_out], judge_calls: o.judged, attempts,
  }, null, 1) + '\n');
  const h = holdout(attempts, Number(arg('seed') ?? 1));
  writeFileSync(join(out, 'holdout.json'), JSON.stringify({ $comment: 'Held back before any run (3.4d step 11): a third of the clips in each group, rounded up, by build-set.ts\'s seeded shuffle.', ...h }, null, 1) + '\n');
  const by = new Map<string, { n: number; red: number; white: number; either: number }>();
  for (const a of attempts) {
    const k = `${a.group}${a.cut === 'lost' ? ' (lost track)' : a.recorded ? ' (planted, recorded)' : ''}`;
    const t = by.get(k) ?? { n: 0, red: 0, white: 0, either: 0 };
    t.n++; t[a.call.startsWith('red') ? 'red' : a.call === 'white' ? 'white' : 'either']++;
    by.set(k, t);
  }
  for (const [k, t] of by) console.log(`${k}: ${t.n} (${t.red} red, ${t.white} white, ${t.either} either)`);
  console.log(`left out: ${[...b.left_out, ...o.left_out].map(l => l.id).join(', ')}`);
  console.log(`held back (seed ${h.seed}): ${h.clips.length} clips, ${h.attempts.length} attempts`);
}

if (require.main === module) main().catch(e => { console.error(e.message ?? e); process.exit(1); });
