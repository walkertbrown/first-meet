// A Home attempt on the phone (3.8a, 5.25 step 6–7): each rep is counted as she stands back up,
// and "Rack!" waits for the declared reps. Run on the saved poses of the five-rep test clip.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TryALift, checkCommandTimes, type Frame, type TryEvent } from '../../web/lib/judge';
import { CLIPS_DIR } from '../clips/check';

const raw = JSON.parse(readFileSync(join(CLIPS_DIR, 'poses', 'racked-squats-side.json'), 'utf8')) as { w: number; h: number; frames: Frame[] };

function run(reps?: number) {
  const tal = new TryALift({ w: raw.w, h: raw.h }, { skipFrameCheck: true, reps });
  const evs: TryEvent[] = [];
  for (const f of raw.frames) { evs.push(...tal.feed(f)); if (tal.phase === 'done') break; }
  return evs;
}

describe('Home reps on the phone', () => {
  it('one rep: a rep then "Rack!", as before', () => {
    const evs = run();
    const kinds = evs.filter(e => e.type !== 'spot').map(e => e.type);
    expect(kinds.slice(-3)).toEqual(['rep', 'rack', 'result']);
    expect(evs.filter(e => e.type === 'rep')).toHaveLength(1);
  });

  it('three declared: three reps counted in order, "Rack!" after the third, not before', () => {
    const evs = run(3);
    const reps = evs.filter((e): e is Extract<TryEvent, { type: 'rep' }> => e.type === 'rep');
    expect(reps.map(r => r.k)).toEqual([1, 2, 3]);
    const rack = evs.find(e => e.type === 'rack')!;
    expect(rack.t).toBeGreaterThanOrEqual(reps[2].t);
    expect((rack as Extract<TryEvent, { type: 'rack' }>).noRep).toBe(false);
  });

  it('the rep times make command_times the server accepts', () => {
    const evs = run(3);
    const squat = evs.find(e => e.type === 'squat')!.t;
    const soft = squat - 1000;
    const ct: Record<string, number> = { loaded: 0, squat: squat - soft };
    for (const e of evs) if (e.type === 'rep') ct[`rep_${e.k}`] = e.t - soft;
    ct.rack = evs.find(e => e.type === 'rack')!.t - soft;
    expect(checkCommandTimes(ct, 'squat', ct.rack + 1500)).toBeNull();
  });
});
