// Item 117 (3.4b, "Lost after a normal Press!"; behind `samePoint`, off until Walker's yes): after a normal "Press!", a
// seen point with exactly the same x and y for 1.5 s of camera time counts as frozen. 3.4b's tests: on "refresh", a
// picture frozen in her pause with its real score (z838's is under 0.6 all through it) and KrDo at 57.80 s (0.674) get
// "Rack!" with `lost` about 4.5 s after the later of "Press!" and the freeze, never at 20 s; and on the 51 grinder reps,
// at every cadence, as filmed and lifted, the rule marks nothing.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { BAR_RULES, BarCaller, type BarCmd, type BarPoint } from '../../web/lib/judge';
import { callPath } from '../../web/lib/judge/bar-measure';
import { GUARD_CASES } from '../bench-commands/guard-after-press';
import { score } from '../bench-commands/score';

const B = join(__dirname, '../bench-commands/data');
type Eye = { grp: string; stop: number; pauseEnd: number };
const EYE = JSON.parse(readFileSync(join(B, 'eyetimes.json'), 'utf8')) as Record<string, Eye>;
type Trace = { w: number; h: number; racked: boolean; mark: { x: number; y: number }; pts: BarPoint[] };
const trace = (id: string) => JSON.parse(readFileSync(join(B, 'traces', `${id}.json`), 'utf8')) as Trace;
const ON = { ...BAR_RULES, samePoint: true };
const TICK = 1000 / 60;
const ms = (s: number) => Math.round(s * 1000);

const startsAsFilmed = (tr: Trace) => {
  const c = new BarCaller(tr.mark, tr, BAR_RULES, tr.racked);
  for (const [t, x, y, s] of tr.pts) { const k = c.feed(t, x, y, s); if (k) return k.cmd === 'start'; }
  return false;
};

/** The clip up to `from`, then the last picture re-read every tick ("refresh") with its own score, for 30 s. */
function frozen(tr: Trace, from: number, rules = ON) {
  const c = new BarCaller(tr.mark, tr, rules, tr.racked);
  const out: BarCmd[] = [];
  const before = tr.pts.filter(p => p[0] < from);
  for (const p of before) { const k = c.feed(...p); if (k) out.push(k); if (c.state === 'done') break; }
  const [t0, x, y, s] = before.at(-1)!;
  for (let m = t0 + TICK; m < t0 + 30000 && c.state !== 'done'; m += TICK) { const k = c.feed(Math.round(m), x, y, s); if (k) out.push(k); }
  return { press: out.find(k => k.cmd === 'press'), rack: out.find(k => k.cmd === 'rack'), frozeAt: t0, score: s };
}

// The 3 clips that score under 0.8 all through her pause (NerdCider, 1:20 AM): frozen on every frame of the eye's pause.
// Every other clip with a pause of at least 0.5 s by eye where the phone calls Start! as filmed: frozen 0.2 and 0.5 s in.
const UNSURE = ['hIuj1H1WOxM', 'z838WQVSBmk', 'xXFjNqroOQ0'];
const CASES: { id: string; at: number }[] = [];
for (const [id, e] of Object.entries(EYE)) {
  if (!startsAsFilmed(trace(id))) continue;
  if (UNSURE.includes(id)) {
    for (const p of trace(id).pts) if (p[0] >= ms(e.stop) && p[0] <= ms(e.pauseEnd)) CASES.push({ id, at: p[0] + 1 });
  } else if (e.pauseEnd - e.stop >= 0.5) for (const into of [200, 500]) CASES.push({ id, at: ms(e.stop) + into });
}
CASES.push({ id: 'KrDo', at: 57800 + 1 }); // NerdCider's 1:15 AM freeze: the frame at 57.80 s, which scores 0.674

describe('a frozen picture after Press!, at its real score (item 117)', () => {
  it('is off in the rules until Walker\'s yes', () => expect(BAR_RULES.samePoint).toBe(false));
  it('covers z838 and the clips scoring under 0.8 in the pause', () => {
    // every frame of the pause: hIuj 24, z838 17, xXFj 6 (NerdCider's count)
    const n = (id: string) => CASES.filter(c => c.id === id).length;
    expect(UNSURE.map(n)).toEqual([24, 17, 6]);
    expect(n('KrDo')).toBeGreaterThanOrEqual(1);
  });
  for (const cs of CASES) {
    it(`${cs.id}, frozen at ${(cs.at / 1000).toFixed(2)} s on "refresh": Rack! (lost) about 4.5 s after the later of Press! and the freeze`, () => {
      const r = frozen(trace(cs.id), cs.at);
      expect(r.press).toBeTruthy();
      expect(r.rack).toMatchObject({ rackWhy: 'lost' });
      expect(r.rack!.noRep).toBeFalsy();
      const from = Math.max(r.press!.t, r.frozeAt);
      expect(r.rack!.t - from).toBeLessThanOrEqual(ON.samePointMs + ON.lostRackMs + 50);
    });
  }
  it('with the switch off, z838 frozen in her pause waits for the 20 s no-rep (why item 117 is asked)', () => {
    const r = frozen(trace('z838WQVSBmk'), ms(EYE.z838WQVSBmk.stop) + 200, BAR_RULES);
    expect(r.score).toBeLessThan(0.8);
    expect(r.rack).toMatchObject({ rackWhy: 'no_rep' });
  });
});

describe("the server's replay of all 22 paths with item 117 on: it marks nothing", () => {
  const ids = readdirSync(join(B, 'server')).map(f => f.replace(/\.json$/, ''));
  it('runs on all 22', () => expect(ids).toHaveLength(22));
  // A whole-clip replay reaches Press! on only some paths, and the rule runs only after it; so, for any cut the server
  // replays: no seen run of one exact point on any server path comes near samePointMs (VibeSearch, 1:18 AM: 0.40 s at most).
  it('no seen run of one exact point on any server path reaches 0.5 s', () => {
    let longest = 0;
    for (const id of ids) {
      const path = JSON.parse(readFileSync(join(B, 'server', `${id}.json`), 'utf8')) as BarPoint[];
      let from: number | null = null;
      path.forEach((p, i) => {
        const q = path[i - 1];
        const seen = p[3] >= ON.lostScore;
        if (seen && q && q[3] >= ON.lostScore && from !== null && p[1] === q[1] && p[2] === q[2]) longest = Math.max(longest, p[0] - from);
        else from = seen ? p[0] : null;
      });
    }
    expect(longest).toBeGreaterThan(0);
    expect(longest).toBeLessThan(500);
    expect(longest).toBeLessThan(ON.samePointMs / 3);
  });
  for (const id of ids) {
    it(`${id}: the same commands and the same seen points as with it off`, () => {
      const path = JSON.parse(readFileSync(join(B, 'server', `${id}.json`), 'utf8')) as BarPoint[];
      const tr = trace(id);
      const ct = { plate_tap: tr.mark } as never;
      expect(callPath(path, ct, tr, ON)).toEqual(callPath(path, ct, tr, BAR_RULES));
    });
  }
});

describe('the grinder run with item 117 on: it marks nothing', () => {
  for (const cs of GUARD_CASES.filter(c => c.guard === 'from')) {
    it(`${cs.live ?? 'grid'}, ${cs.lift ? `scores lifted to ${cs.lift}` : 'scores as filmed'}: every rep the same as with it off`, () => {
      const opts = { allReps: true, live: cs.live, lift: cs.lift };
      const on = score(ON, undefined, opts).rows, off = score(BAR_RULES, undefined, opts).rows;
      expect(on.length).toBe(51);
      expect(JSON.stringify(on)).toBe(JSON.stringify(off.map(r => ({ ...r }))));
    }, 120000);
  }
});
