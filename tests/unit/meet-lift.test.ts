// One meet attempt on the phone, every lift (5.25 steps 3–7, 3.8a): the commands come in the
// lift's order, are saved under the keys the server reads, and the server accepts them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeetLift, type MeetEvent, type MeetLiftName } from '@/lib/judge/meet-lift';
import { checkCommandTimes, RULES, type Frame } from '@/lib/judge';
import { liftCommands } from '@/lib/stage/meet-words';
import { CLIPS_DIR } from '../clips/check';
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

  it('bench: "Start!", "Press!" on the pause, "Rack!"', () => {
    const frames = [...still(0, 1000, UP), ...move(1000, 1000, UP, DOWN), ...still(2000, 900, DOWN), ...move(2900, 800, DOWN, UP), ...still(3700, 1500, UP)];
    const { said, ct } = run(lead(UP, frames), d, 'bench');
    expect(said).toEqual(['start', 'press', 'rack']);
    expect(ct.press).toBeGreaterThan(ct.start);
    expect(ok(ct, 'bench')).toBeNull();
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
