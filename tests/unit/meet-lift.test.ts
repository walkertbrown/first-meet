// One meet attempt on the phone, every lift (5.25 steps 3–7, 3.8a): the commands come in the
// lift's order, are saved under the keys the server reads, and the server accepts them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeetLift, type MeetEvent, type MeetLiftName } from '@/lib/judge/meet-lift';
import { checkCommandTimes, RULES, type Frame } from '@/lib/judge';
import { liftCommands } from '@/lib/stage/meet-words';
import { CLIPS_DIR } from '../clips/check';
import { extrasOk } from '@/lib/judge/bar-measure';
import { BENCH, DIMS, RACK, frame, run as runBar, type Seg } from './bar-frames';
import { d, hold, arm, move, UP, DOWN, front, moveFront, F_RACKED, F_LOCKED } from './press-poses';

const poses = (name: string) => JSON.parse(readFileSync(join(CLIPS_DIR, 'poses', `${name}.json`), 'utf8')) as { w: number; h: number; frames: Frame[] };

function run(frames: Frame[], dims: { w: number; h: number }, lift: MeetLiftName, reps?: number) {
  const m = new MeetLift(dims, lift, { reps, skipFrameCheck: true });
  const evs: MeetEvent[] = [];
  for (const f of frames) { evs.push(...m.feed(f)); if (m.phase === 'done') break; }
  // command_times as the stage writes them: from the soft command, which starts the recording
  const soft = evs.find(e => e.type === 'loaded')!.t;
  const ct: Record<string, number> = { [reps ? 'ready' : 'loaded']: 0 };
  for (const e of evs) if (e.type === 'call' || e.type === 'rep' || e.type === 'end') ct[e.key] = Math.round(e.t - soft);
  const said = evs.flatMap(e => (e.type === 'call' ? [e.word] : e.type === 'end' ? [e.key] : e.type === 'rep' && e.down ? ['down'] : []));
  return { evs, ct, said, m };
}
const ok = (ct: Record<string, number>, lift: MeetLiftName) => checkCommandTimes(ct, lift, Math.max(...Object.values(ct)) + 1500);

describe('a meet attempt on the phone', () => {
  it('squat: "Squat!", then "Rack!", saved as the server reads them', () => {
    const p = poses('racked-squats-side');
    const { said, ct, evs } = run(p.frames, p, 'squat');
    expect(said).toEqual(['squat', 'rack']);
    expect(evs.find(e => e.type === 'end')).toMatchObject({ noRep: false });
    expect(ok(ct, 'squat')).toBeNull();
  });

  it('Home goblet squat: three reps counted, "Rack!" after the third', () => {
    const p = poses('racked-squats-side');
    const { evs, ct } = run(p.frames, p, 'squat', 3);
    expect(evs.filter(e => e.type === 'rep').map(e => (e as { k: number }).k)).toEqual([1, 2, 3]);
    expect(Object.keys(ct)).toEqual(expect.arrayContaining(['ready', 'squat', 'rep_1', 'rep_2', 'rep_3', 'rack']));
    expect(ok(ct, 'squat')).toBeNull();
  });

  it('deadlift: no start command, "Down!" at the lockout', () => {
    const p = poses('deadlift-demo');
    const { said, ct } = run(p.frames, p, 'deadlift');
    expect(said).toEqual(['down']);
    expect(ct.down).toBeGreaterThan(0);
    expect(ok(ct, 'deadlift')).toBeNull();
  });

  it('Home deadlift: "Down!" after each rep, the last one ends it', () => {
    const p = poses('deadlift-demo');
    // the demo clip has two pulls in it: her two reps
    const { evs, said, ct } = run(p.frames, p, 'deadlift', 2);
    expect(evs.filter(e => e.type === 'rep').map(e => [(e as { k: number }).k, (e as { down: boolean }).down])).toEqual([[1, true], [2, false]]);
    expect(said).toEqual(['down', 'down']);
    expect(ct.down).toBe(ct.rep_2);
    expect(ok(ct, 'deadlift')).toBeNull();
  });

  it('Home deadlift: she stops short of her reps, "Down!" once she has stood still for a while', () => {
    const p = poses('deadlift-demo');
    const frames = p.frames;
    const last = frames[frames.length - 1];
    const rest = Array.from({ length: Math.ceil((RULES.deadlift.homeNoRepMs + 1000) / 33) }, (_, i) => ({ ...last, t: last.t + 33 * (i + 1) }));
    const { evs, ct } = run([...frames, ...rest], p, 'deadlift', 3);
    expect(evs.filter(e => e.type === 'rep')).toHaveLength(2);
    expect(evs.at(-1)).toMatchObject({ type: 'end', key: 'down', noRep: false });
    expect(ct.down - ct.rep_2).toBeGreaterThanOrEqual(RULES.deadlift.homeNoRepMs);
  });

  const still = (t0: number, ms: number, a: [number, number]) => hold(t0, ms, t => arm(a[0], a[1], { jitter: 2, t }));
  // the stage waits this long after "Good spot." for the soft command: she stands there first
  const LEAD = RULES.tryALift.goodSpotToStandTallMs + 200;
  const lead = (pose: [number, number], frames: Frame[]) => [...still(0, LEAD, pose), ...frames.map(f => ({ ...f, t: f.t + LEAD }))];

  it('Barbell bench (3.4b): "Tap the end of the bar", her tap, "Bar is loaded.", then the bar\'s "Start!", "Press!", "Rack!"', () => {
    const m = new MeetLift(DIMS, 'bench', { skipFrameCheck: true });
    expect(m.byBar).toBe(true);
    // the spot, then "Good spot." held, then the tap is asked for; poses stop counting there
    const evs: MeetEvent[] = [];
    for (let t = 0; t <= RULES.tryALift.goodSpotToStandTallMs + 100; t += 100) evs.push(...m.feed({ t, p: null }));
    expect(evs.map(e => e.type)).toEqual(['spot', 'good-spot', 'tap-ask']);
    expect(m.phase).toBe('tap');
    expect(m.feed({ t: 5000, p: null })).toEqual([]);
    // no frames do anything until she taps
    expect(m.feedBar(frame(...RACK, 0), 0)).toEqual([]);
    expect(m.tapBar(frame(...RACK, 0), ...RACK)).toBe(true);
    expect(m.plateTap).toEqual({ x: RACK[0], y: RACK[1], size: 0.08 });
    const { evs: bar } = runBar({ feed: (g, t) => m.feedBar(g, t) }, RACK, BENCH);
    // "Bar is loaded." on the first frame after the tap, then the mark, then the commands
    expect(bar[0].type).toBe('loaded');
    const said = bar.flatMap(e => (e.type === 'call' ? [e.key] : e.type === 'end' ? [e.key] : []));
    expect(said).toEqual(['start', 'press', 'rack']);
    const start = bar.findIndex(e => e.type === 'call');
    expect(bar.slice(1, start).filter(e => e.type === 'mark').length).toBeGreaterThan(30);
    expect(bar.slice(start).some(e => e.type === 'mark')).toBe(false);
    expect(m.phase).toBe('done');
    const end = bar.at(-1)!;
    expect(end).toMatchObject({ type: 'end', key: 'rack', noRep: false });
    expect('void' in end).toBe(false);
    // command_times as the stage writes them, with plate_tap: the server takes them
    const soft = bar[0].t;
    const ct: Record<string, unknown> = { loaded: 0, plate_tap: m.plateTap };
    for (const e of bar) if (e.type === 'call' || e.type === 'end') ct[e.key] = Math.round(e.t - soft);
    expect(ok(ct as Record<string, number>, 'bench')).toBeNull();
    expect(extrasOk(ct as Record<string, number>)).toBe(true);
  });

  it('Barbell bench: lost on the hooks says so and asks for a new tap, with no second "Bar is loaded."', () => {
    const m = new MeetLift(DIMS, 'bench', { atTap: true });
    expect(m.phase).toBe('tap');
    m.tapBar(frame(...RACK, 0), ...RACK);
    const a = runBar({ feed: (g, t) => m.feedBar(g, t) }, RACK, [{ ms: 500 }, { ms: 1500, plate: false }]);
    expect(a.evs.filter(e => e.type === 'lost')).toHaveLength(1);
    expect(m.plateTap).toBeNull();
    expect(m.tapBar(frame(...RACK, 99), ...RACK)).toBe(true);
    const b = runBar({ feed: (g, t) => m.feedBar(g, t) }, RACK, BENCH, a.t);
    expect(b.evs.some(e => e.type === 'loaded')).toBe(false);
    expect(b.evs.flatMap(e => (e.type === 'call' || e.type === 'end' ? [e.key] : []))).toEqual(['start', 'press', 'rack']);
  });

  it('Barbell bench: no "Start!" out of the rack is a void "Rack!"', () => {
    const m = new MeetLift(DIMS, 'bench', { atTap: true });
    m.tapBar(frame(...RACK, 0), ...RACK);
    const wander: Seg[] = [{ ms: 1000 }, { ms: 600, to: [0.55, 0.22] }];
    for (let i = 0; i < 12; i++) wander.push({ ms: 500, to: i % 2 ? [0.55, 0.22] : [0.5, 0.27] });
    const { evs } = runBar({ feed: (g, t) => m.feedBar(g, t) }, RACK, wander);
    expect(evs.at(-1)).toMatchObject({ type: 'end', key: 'rack', void: true });
    expect(evs.some(e => e.type === 'call')).toBe(false);
  });

  it('Barbell bench: a late "Press!" after the track is lost says why, for press_late_why', () => {
    const m = new MeetLift(DIMS, 'bench', { atTap: true });
    m.tapBar(frame(...RACK, 0), ...RACK);
    const { evs } = runBar({ feed: (g, t) => m.feedBar(g, t) }, RACK, [...BENCH.slice(0, 3), { ms: 500, to: [0.55, 0.3] }, { ms: 2600, plate: false }, { ms: 3200, plate: false }]);
    expect(evs.find(e => e.type === 'call' && e.word === 'press')).toMatchObject({ key: 'press_late', why: 'lost' });
  });

  it('Home overhead press: "Start!", each rep counted, "Rack!" at the declared reps, no "Press!"', () => {
    // filmed front-on (3.4c)
    const fstill = (t0: number, ms: number, a: [number, number]) => hold(t0, ms, t => front(a[0], a[1], { jitter: 2, t }));
    const rep = (t0: number) => [...moveFront(t0, 700, F_RACKED, F_LOCKED), ...fstill(t0 + 700, 800, F_LOCKED), ...moveFront(t0 + 1500, 700, F_LOCKED, F_RACKED), ...fstill(t0 + 2200, 300, F_RACKED)];
    const frames = [...fstill(0, LEAD, F_RACKED), ...[...fstill(0, 1000, F_RACKED), ...rep(1000), ...rep(3500)].map(f => ({ ...f, t: f.t + LEAD }))];
    const { said, ct, evs } = run(frames, d, 'bench', 2);
    expect(said).toEqual(['start', 'rack']);
    expect(evs.filter(e => e.type === 'rep')).toHaveLength(2);
    expect(ok(ct, 'bench')).toBeNull();
  });

  it('the words on screen match each lift\'s commands (5.25 step 5)', () => {
    expect(liftCommands('squat', 'barbell')).toEqual({ calls: ['SQUAT!'], end: 'RACK!' });
    expect(liftCommands('bench', 'barbell')).toEqual({ calls: ['START!', 'PRESS!'], end: 'RACK!' });
    expect(liftCommands('bench', 'home')).toEqual({ calls: ['START!'], end: 'RACK!' });
    expect(liftCommands('deadlift', 'home')).toEqual({ calls: [], end: 'DOWN!' });
  });
});
