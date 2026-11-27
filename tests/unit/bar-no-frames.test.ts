// Item 114 (3.2, "The time rules keep running with no frames") and item 116 (3.4b, "Lost after a normal Press!"):
// the camera's frames stop, and the refresh tick still runs the bar's time rules. "Press!" never comes from frames the
// camera didn't send, she's never left holding the bar with no "Rack!", and every Rack! says why (`rack_why`).
import { describe, expect, it } from 'vitest';
import { BAR_RULES, BarCaller, measureBar, type BarCmd, type BarPoint } from '../../web/lib/judge';
import { BarStage } from '../../web/lib/judge/bar-stage';
import { DT, RACK, frame } from './bar-frames';

const DIMS = { w: 284, h: 160 };
const GAP = 1000 / 30;
/** the screen's refresh: the tick runs this often while no frame comes */
const TICK = 1000 / 60;

/**
 * A bench, as the caller sees it, off the hooks from t 0: held at the top (Start!), down 0.2 in 1 s, held on her chest
 * until "Press!", then up in `upMs` and held at the top. A real held bar wobbles, so the stuck rule never takes it.
 * `stop`: no frames in [from, to). `lost`: frames in [from, to) where the track's score is under the line.
 * `freeze`: from that time, every frame is the same picture (the last frame's spot, no wobble, score 0.995), as a stalled
 * camera on "refresh" or a tracker stuck on something still. `rules`: rules over BAR_RULES.
 */
type Opts = { stop?: [number, number]; lost?: [number, number]; freeze?: number | ((press: number | null) => number | null); upMs?: number; until?: number; ticks?: boolean; rules?: Partial<typeof BAR_RULES> };
function bench(o: Opts = {}) {
  const c = new BarCaller({ x: 0.55, y: 0.3 }, DIMS, { ...BAR_RULES, ...o.rules }, false);
  const out: BarCmd[] = [];
  let frozen: BarPoint | null = null;
  const path: BarPoint[] = [];
  const upMs = o.upMs ?? 900;
  let pressAt: number | null = null, lastFrame = -Infinity;
  const y = (t: number) => {
    if (pressAt === null) return t < 1500 ? 0.22 : t < 2500 ? 0.22 + (0.2 * (t - 1500)) / 1000 : 0.42;
    const u = (t - pressAt) / upMs;
    return u >= 1 ? 0.22 : 0.42 - 0.2 * u;
  };
  const wob = (k: number) => (k % 2 ? 0.003 : -0.003);
  const push = (cmd: BarCmd | null) => {
    if (!cmd) return;
    out.push(cmd);
    if (cmd.cmd === 'press') pressAt = cmd.t;
  };
  const until = o.until ?? 15000;
  let k = 0;
  for (let ms = 0; ms < until && c.state !== 'done'; ms += TICK) {
    // the camera's frames, at GAP, unless stopped
    while (k * GAP <= ms && c.state !== 'done') {
      const t = Math.round(k * GAP);
      const stopped = o.stop && t >= o.stop[0] && t < o.stop[1];
      if (!stopped) {
        const fz = typeof o.freeze === 'function' ? o.freeze(pressAt) : o.freeze;
        if (fz != null && t >= fz && !frozen) frozen = path.at(-1) ?? [t, 0.55, y(t), 0.995];
        const score = frozen ? 0.995 : o.lost && t >= o.lost[0] && t < o.lost[1] ? 0.2 : 0.9;
        const yy = frozen ? frozen[2] : y(t) + wob(k);
        path.push([t, 0.55, yy, score]);
        push(c.feed(t, 0.55, yy, score));
        lastFrame = t;
      }
      k++;
    }
    if (o.ticks !== false && c.state !== 'done' && ms > lastFrame) push(c.tick(Math.round(ms)));
  }
  const at = (cmd: BarCmd['cmd']) => out.find(x => x.cmd === cmd);
  return { c, out, path, start: at('start'), press: at('press'), rack: at('rack') };
}

/** command_times from the caller's commands, the way the page sends them (press_late, press_late_why). */
const ctOf = (out: BarCmd[]) => {
  const ct: Record<string, unknown> = { loaded: 0 };
  for (const x of out) {
    ct[x.cmd === 'press' && x.late ? 'press_late' : x.cmd] = x.t;
    if (x.cmd === 'press' && x.why) ct.press_late_why = x.why;
    if (x.cmd === 'rack' && x.rackWhy) ct.rack_why = x.rackWhy;
  }
  return ct as never;
};

/** The last frame fed before `t`. */
const lastBefore = (path: BarPoint[], t: number) => path.filter(p => p[0] < t).at(-1)![0];

const base = bench();

describe('the bench with every frame (item 114, the baseline)', () => {
  it('calls Start!, Press! and Rack! (up), with the tick running between frames', () => {
    expect(base.out.map(x => x.cmd)).toEqual(['start', 'press', 'rack']);
    expect(base.press!.late).toBeFalsy();
    expect(base.rack!.rackWhy).toBe('up');
  });
  it('the tick changes nothing while the frames come', () => {
    const plain = bench({ ticks: false });
    expect(plain.out).toEqual(base.out);
  });
  it('noFrameMs is 500 ms (shared/rules.json)', () => expect(BAR_RULES.noFrameMs).toBe(500));
});

describe('frames stop partway through her pause (3.2, VibeSearch, Nov 26)', () => {
  const P = base.press!.t;

  it('a 300 ms stop: "Press!" comes on the first frame after it, within one camera frame of its end', () => {
    const r = bench({ stop: [P - 150, P + 150] });
    expect(r.press!.late).toBeFalsy();
    expect(r.press!.t).toBeGreaterThanOrEqual(P + 150);
    expect(r.press!.t).toBeLessThanOrEqual(P + 150 + GAP + 1);
    expect(r.rack!.rackWhy).toBe('up');
  });

  for (const ms of [600, 1000]) {
    it(`a ${ms} ms stop: lost from the last frame, "Press!" 2 s after it (why lost), never from stillness; the pause is not measured`, () => {
      const r = bench({ stop: [P - 300, P - 300 + ms] });
      const last = lastBefore(r.path, P - 300);
      expect(r.press).toMatchObject({ late: true, why: 'lost' });
      // frames came back long before; "Press!" still waits for the 2 s (on a frame or on the tick, whichever is first)
      expect(r.press!.t).toBeGreaterThanOrEqual(last + BAR_RULES.lostLateMs);
      expect(r.press!.t).toBeLessThanOrEqual(last + BAR_RULES.lostLateMs + GAP + 1);
      // the frames show her press up, so Rack! comes on the back-up rule, and no later than 3 s after Press!
      expect(r.rack!.rackWhy).toBe('up');
      expect(r.rack!.t - r.press!.t).toBeLessThanOrEqual(BAR_RULES.lostRackMs);
      const m = measureBar(r.path, ctOf(r.out), DIMS);
      expect(m.pause_s).toBeNull();
    });
  }

  it('frames that stop for good mid-pause: "Press!" 2 s after the last frame on the tick, then "Rack!" 3 s after it (why lost)', () => {
    const r = bench({ stop: [P - 300, 1e9] });
    const last = lastBefore(r.path, P - 300);
    expect(r.press).toMatchObject({ late: true, why: 'lost' });
    expect(r.press!.t).toBeGreaterThanOrEqual(last + BAR_RULES.lostLateMs);
    expect(r.press!.t).toBeLessThanOrEqual(last + BAR_RULES.lostLateMs + TICK + 1);
    expect(r.rack!.rackWhy).toBe('lost');
    expect(r.rack!.t - r.press!.t).toBeGreaterThanOrEqual(BAR_RULES.lostRackMs);
    expect(r.rack!.t - r.press!.t).toBeLessThanOrEqual(BAR_RULES.lostRackMs + TICK + 1);
  });

  it('with no tick at all (a hidden tab), the late Press! comes on the first frame after its time', () => {
    const r = bench({ stop: [P - 300, P + 2500], ticks: false });
    const last = lastBefore(r.path, P - 300);
    expect(r.press).toMatchObject({ late: true, why: 'lost' });
    expect(r.press!.t).toBeGreaterThanOrEqual(last + BAR_RULES.lostLateMs);
    expect(r.press!.t).toBeLessThanOrEqual(P + 2500 + GAP + 1);
  });
});

describe('frames stop off the hooks, before Start! (3.2)', () => {
  it('frames stop for 1 s: the lost-bar void "Rack!" comes on time, 1 s after the last frame', () => {
    const r = bench({ stop: [300, 1300] });
    const last = lastBefore(r.path, 300);
    expect(r.out).toHaveLength(1);
    expect(r.rack).toMatchObject({ void: true, voidWhy: 'low_score' });
    expect(r.rack!.t).toBeGreaterThanOrEqual(last + BAR_RULES.lowScoreBeforeMs);
    expect(r.rack!.t).toBeLessThanOrEqual(last + BAR_RULES.lowScoreBeforeMs + TICK + 1);
    expect(r.rack!.rackWhy).toBeUndefined();
  });
  it('a 400 ms stop is not a loss: Start! comes as usual', () => {
    const r = bench({ stop: [300, 700] });
    expect(r.out.map(x => x.cmd)).toEqual(['start', 'press', 'rack']);
  });
});

describe('lost after a normal "Press!" (item 116, 3.4b)', () => {
  const P = base.press!.t;

  it('frames stop for good 1 s after Press!: "Rack!" 3 s after the last frame, why lost', () => {
    const r = bench({ stop: [P + 1000, 1e9], upMs: 2000 });
    const last = lastBefore(r.path, P + 1000);
    expect(r.press!.late).toBeFalsy();
    expect(r.rack!.rackWhy).toBe('lost');
    expect(r.rack!.t).toBeGreaterThanOrEqual(last + BAR_RULES.lostRackMs);
    expect(r.rack!.t).toBeLessThanOrEqual(last + BAR_RULES.lostRackMs + TICK + 1);
  });

  it('the track lost for good after Press!: "Rack!" 3 s after the first lost frame, why lost', () => {
    const r = bench({ lost: [P + 300, 1e9], upMs: 2000 });
    const first = r.path.find(p => p[0] >= P + 300)![0];
    expect(r.rack!.rackWhy).toBe('lost');
    expect(r.rack!.t).toBeGreaterThanOrEqual(first + BAR_RULES.lostRackMs);
    expect(r.rack!.t).toBeLessThanOrEqual(first + BAR_RULES.lostRackMs + GAP + 1);
  });

  it('a short gap mid-press (under 500 ms) is not a loss: "Rack!" at the lockout, why up', () => {
    const r = bench({ stop: [P + 300, P + 700] });
    expect(r.rack!.rackWhy).toBe('up');
    expect(r.rack!.t).toBeLessThan(base.rack!.t + 2 * GAP);
  });

  it('found again before the 3 s: the timer is dropped, and "Rack!" comes at her lockout, why up (NerdCider case 2)', () => {
    // lost 600 ms mid-press, found, and a slow press locks out about 4 s after the loss
    const r = bench({ lost: [P + 300, P + 900], upMs: 4000 });
    expect(r.rack!.rackWhy).toBe('up');
    expect(r.rack!.t).toBeGreaterThan(P + 300 + BAR_RULES.lostRackMs);
    expect(r.rack!.t).toBeGreaterThanOrEqual(P + 4000);
  });

  it('no seen frame at all after Press!: "Rack!" 3 s after the loss, before the no-rep rule', () => {
    const r = bench({ stop: [P + 1, 1e9] });
    expect(r.rack!.rackWhy).toBe('lost');
    expect(r.rack!.t).toBeLessThanOrEqual(P + BAR_RULES.lostRackMs + TICK + 1);
    expect(r.rack!.noRep).toBeFalsy();
  });

  for (const guard of [true, 'from'] as const) {
    it(`guard ${guard}: the picture stalls 1 s after Press!, mid-press: "Rack!" about 4.5 s after the stall, why lost (NerdCider case 1)`, () => {
      const r = bench({ freeze: pa => (pa === null ? null : pa + 1000), upMs: 3000, rules: { guardAfterPress: guard } });
      expect(r.press!.late).toBeFalsy();
      expect(r.rack!.rackWhy).toBe('lost');
      const stall = r.press!.t + 1000;
      // the guard marks it 1.5 s after the stall, and Rack! comes 3 s after the mark; with item 117 on, the point that
      // doesn't move may mark it up to two frames sooner (it counts from the frozen frame's own time, and that frame's
      // time on screen)
      expect(r.rack!.t).toBeGreaterThanOrEqual(stall + Math.min(BAR_RULES.freezeAfterMs, BAR_RULES.samePointMs) + BAR_RULES.lostRackMs - 3 * GAP);
      expect(r.rack!.t).toBeLessThanOrEqual(stall + BAR_RULES.freezeAfterMs + BAR_RULES.lostRackMs + 2 * GAP);
    });
    it(`guard ${guard}: the picture stalls just as she locks out: "Rack!" at the lockout, why up, within 400 ms`, () => {
      // the press takes 900 ms; the picture freezes on the first frame at the top
      const r = bench({ freeze: pa => (pa === null ? null : pa + 900 + GAP), rules: { guardAfterPress: guard } });
      expect(r.rack!.rackWhy).toBe('up');
      expect(r.rack!.t - (r.press!.t + 900)).toBeLessThanOrEqual(400);
    });
  }
  // the bench's pause on her chest runs from 2.5 s to Press!
  for (const into of [200, 500]) {
    it(`guard from: the picture freezes ${into} ms into her pause and stays frozen ("refresh"): "Rack!" about 4.5 s after Press!, why lost, not at 20 s`, () => {
      const r = bench({ freeze: 2500 + into, rules: { guardAfterPress: 'from' }, until: 30000 });
      expect(r.press).toBeTruthy();
      expect(r.rack!.rackWhy).toBe('lost');
      expect(r.rack!.t - r.press!.t).toBeLessThanOrEqual(BAR_RULES.freezeAfterMs + BAR_RULES.lostRackMs + 2 * GAP);
      expect(r.rack!.t - r.press!.t).toBeGreaterThanOrEqual(BAR_RULES.freezeAfterMs + BAR_RULES.lostRackMs - GAP);
      // nothing before Press! is blanked
      expect(Math.min(...r.c.frozeFrom.filter(f => f > 2000))).toBeGreaterThanOrEqual(r.press!.t - GAP);
    });
    it(`guard from: the frames stop ${into} ms into her pause and never come back ("frame"): "Rack!" no more than about 4.5 s after Press!, why lost`, () => {
      const r = bench({ stop: [2500 + into, 1e9], rules: { guardAfterPress: 'from' }, until: 30000 });
      expect(r.press).toBeTruthy();
      expect(r.rack!.rackWhy).toBe('lost');
      expect(r.rack!.t - r.press!.t).toBeLessThanOrEqual(BAR_RULES.freezeAfterMs + BAR_RULES.lostRackMs + 2 * GAP);
    });
  }
  it('guard true, a picture frozen in her pause: marked earlier, and the blanked stretch reaches back across Press!', () => {
    const r = bench({ freeze: 2700, rules: { guardAfterPress: true }, until: 30000 });
    expect(r.rack!.rackWhy).toBe('lost');
    expect(Math.min(...r.c.frozeFrom.filter(f => f > 2000))).toBeLessThan(r.press!.t);
  });
  it('the guard is on in shared/rules.json, counting from Press! (Walker\'s yes, 1:03 AM)', () => expect(BAR_RULES.guardAfterPress).toBe('from'));
  it('guard off and item 117 off: the same stall mid-press is never marked lost', () => {
    const r = bench({ freeze: pa => (pa === null ? null : pa + 1000), upMs: 3000, until: 25000, rules: { guardAfterPress: false, samePoint: false } });
    expect(r.rack?.rackWhy).not.toBe('lost');
  });

  it('the no-rep rule runs on the tick: 20 s from Start! with no Press!, why no_rep', () => {
    // held at the top after Start!, never down: no Press!
    const c = new BarCaller({ x: 0.55, y: 0.3 }, DIMS, BAR_RULES, false);
    let t = 0, k = 0, start: number | null = null;
    for (; c.state !== 'done' && t < 3000; t = Math.round(++k * GAP)) {
      const cmd = c.feed(t, 0.55, 0.22 + (k % 2 ? 0.003 : -0.003), 0.9);
      if (cmd?.cmd === 'start') start = cmd.t;
    }
    expect(start).not.toBeNull();
    // then she's seen, but the frames carry on far apart: the tick alone gives Rack! at 20 s
    let rack: BarCmd | null = null;
    for (let ms = t; !rack && ms < start! + 25000; ms += TICK) {
      rack = c.tick(Math.round(ms));
      if (!rack && Math.round(ms) % 400 < TICK) rack = c.feed(Math.round(ms), 0.55, 0.22, 0.9);
    }
    expect(rack).toMatchObject({ cmd: 'rack', noRep: true, rackWhy: 'no_rep' });
    expect(rack!.t - start!).toBeGreaterThanOrEqual(BAR_RULES.noRepMs);
    expect(rack!.t - start!).toBeLessThanOrEqual(BAR_RULES.noRepMs + TICK + 1);
  });
});

describe('the stuck rule across a camera stop (3.2: a gap over 500 ms ends a stuck stretch)', () => {
  it('a frozen picture either side of a 600 ms gap is never 1.5 s stuck', () => {
    const c = new BarCaller({ x: 0.55, y: 0.3 }, DIMS, BAR_RULES, false);
    let k = 0, t = 0;
    for (; c.state === 'waiting' && t < 3000; t = Math.round(++k * GAP)) c.feed(t, 0.55, 0.22 + (k % 2 ? 0.003 : -0.003), 0.9);
    expect(c.state).toBe('lifting');
    const t0 = t;
    for (; t < t0 + 1000; t = Math.round(++k * GAP)) c.feed(t, 0.55, 0.3, 1);
    const t1 = t + 600;
    for (t = t1; t < t1 + 700; t += Math.round(GAP)) c.feed(t, 0.55, 0.3, 1);
    expect(c.frozeAt).toEqual([]);
  });
});

describe('the stage with no frames (item 114: BarStage.idle)', () => {
  it('lost on the hooks: the 1 s tap loss comes on the tick when the frames stop', () => {
    const st = new BarStage({ w: 1280, h: 720 });
    st.tap(frame(...RACK, 0), ...RACK);
    let t = 0, k = 0;
    for (; t < 500; t = Math.round(++k * DT)) st.feed(frame(...RACK, k), t);
    const last = st.path.at(-1)!.t;
    let lost: number | null = null;
    for (let ms = last + TICK; lost === null && ms < last + 3000; ms += TICK) {
      const ev = st.idle(Math.round(ms)).find(e => e.type === 'lost');
      if (ev) lost = ev.t;
    }
    expect(lost).not.toBeNull();
    expect(lost!).toBeGreaterThanOrEqual(last + BAR_RULES.tapLostMs);
    expect(lost!).toBeLessThanOrEqual(last + BAR_RULES.tapLostMs + TICK + 1);
    expect(st.state).toBe('tap');
  });
  it('idle adds nothing to the path, and does nothing before the tap', () => {
    const st = new BarStage({ w: 1280, h: 720 });
    expect(st.idle(100)).toEqual([]);
    st.tap(frame(...RACK, 0), ...RACK);
    st.feed(frame(...RACK, 1), 33);
    st.idle(200);
    expect(st.path).toHaveLength(1);
  });
});
