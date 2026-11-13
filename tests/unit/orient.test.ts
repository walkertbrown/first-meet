// Which way the phone stands (plan 3.10, look 4a and 4b): gravity, not the screen, so rotation lock can't
// break it. The stage's use of it is checked in the source at the end.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apart, GravityWatch, nearestQuarter, ORIENT_WORDS, phoneKind, screenTurn, tiltDeg, wayFor, wayOf } from '../../web/lib/stage/orient';

const G = 9.81;
const rad = (d: number) => (d * Math.PI) / 180;
/** gravity in the screen's plane for a phone tilted `deg` (0 upright, +90 its top to her left), as the spec reports it */
const at = (deg: number, s = 1) => ({ x: s * G * Math.sin(rad(deg)), y: s * G * Math.cos(rad(deg)) });

/** feeds the watch a steady tilt for `ms`, 60 samples a second; returns the time it ends at */
function hold(w: GravityWatch, deg: number, from: number, ms: number, s = 1) {
  let t = from;
  for (; t <= from + ms; t += 1000 / 60) { const g = at(deg, s); w.feed(g.x, g.y, t); }
  return t;
}

describe('which way each lift is filmed (3.10)', () => {
  it('only the Barbell bench is on its side; the Home press and every standing lift are tall', () => {
    expect(wayFor('bench', 'barbell')).toBe('side');
    expect(wayFor('bench', 'home')).toBe('tall');
    for (const l of ['squat', 'deadlift']) for (const d of ['barbell', 'home'] as const) expect(wayFor(l, d)).toBe('tall');
    expect(wayOf(90)).toBe('side');
    expect(wayOf(-90)).toBe('side');
    expect(wayOf(0)).toBe('tall');
  });
});

describe('the tilt from gravity', () => {
  it('0 upright, +90 with the top turned to her left (x = +9.8), -90 to the right', () => {
    expect(tiltDeg(0, G)).toBeCloseTo(0);
    expect(tiltDeg(G, 0)).toBeCloseTo(90);
    expect(tiltDeg(-G, 0)).toBeCloseTo(-90);
    expect(Math.abs(tiltDeg(0, -G))).toBeCloseTo(180);
    // a platform that reports the axes the other way round
    expect(tiltDeg(-G, 0, -1)).toBeCloseTo(90);
  });
  it('the shortest turn between two angles, and the nearest quarter', () => {
    expect(apart(170, -170)).toBeCloseTo(20);
    expect(apart(90, -90)).toBeCloseTo(180);
    expect(nearestQuarter(70)).toBe(90);
    expect(nearestQuarter(-50)).toBe(-90);
    expect(nearestQuarter(20)).toBe(0);
    expect(nearestQuarter(-160)).toBe(180);
  });
});

describe('the watch: 500 ms past 60° (look 4b)', () => {
  it('settles on the way it first holds for 500 ms', () => {
    const w = new GravityWatch();
    hold(w, 5, 0, 400);
    expect(w.quarter).toBeNull();
    hold(w, 5, 417, 200);
    expect(w.quarter).toBe(0);
    expect(w.way).toBe('tall');
  });
  it('turns only once the tilt has stayed more than 60° from it for 500 ms', () => {
    const w = new GravityWatch();
    let t = hold(w, 0, 0, 600);
    t = hold(w, 55, t, 2000); // propped at 55°: still tall
    expect(w.quarter).toBe(0);
    t = hold(w, 80, t, 450);
    expect(w.quarter).toBe(0);
    hold(w, 85, t, 100);
    expect(w.quarter).toBe(90);
    expect(w.way).toBe('side');
  });
  it('a bump mid-lift never turns it', () => {
    const w = new GravityWatch();
    let t = hold(w, -88, 0, 600);
    expect(w.quarter).toBe(-90);
    t = hold(w, -10, t, 300); // knocked upright for 300 ms
    hold(w, -88, t, 2000);
    expect(w.quarter).toBe(-90);
  });
  it('skips a phone lying flat: under half of gravity in the screen\'s plane says nothing', () => {
    const w = new GravityWatch();
    for (let t = 0; t < 2000; t += 16) w.feed(0.5, 1, t);
    expect(w.quarter).toBeNull();
    expect(w.feed(null, null, 3000)).toBe(false);
  });
  it('learns the platform\'s sign from upright samples, so an inverted iPhone still reads right', () => {
    const w = new GravityWatch(1);
    const t = hold(w, 0, 0, 600, -1); // upright, reported as y = -9.8
    expect(w.sign).toBe(-1);
    expect(w.quarter).toBe(0);
    hold(w, 90, t, 700, -1);
    expect(w.quarter).toBe(90);
  });
});

describe('look 4b: the screen turns the other way to the phone', () => {
  it('a phone with its top to her left draws rotate(90deg); to her right, rotate(-90deg)', () => {
    expect(screenTurn(90)).toBe(90);
    expect(screenTurn(-90)).toBe(-90);
    expect(screenTurn(0)).toBe(0);
  });
  it('the rotation-lock line names her phone', () => {
    expect(phoneKind('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', false)).toBe('iphone');
    expect(phoneKind('Mozilla/5.0 (Macintosh)', true)).toBe('iphone'); // an iPad that asks for motion
    expect(phoneKind('Mozilla/5.0 (Linux; Android 14; Pixel 8)', false)).toBe('android');
    expect(phoneKind('Mozilla/5.0 (X11; Linux x86_64)', false)).toBeNull();
  });
});

describe("the plan's words (3.10)", () => {
  it('the turning phone, the rotation-lock lines, the motion step and the turned void', () => {
    expect(ORIENT_WORDS.turn).toEqual({ side: 'Turn your phone on its side for this one.', tall: 'Stand your phone up tall again for this one.' });
    expect(ORIENT_WORDS.lock.iphone).toBe("If the screen doesn't turn, rotation lock is on. Swipe down from the top-right corner and tap the lock, then turn your phone again.");
    expect(ORIENT_WORDS.lock.android).toBe("If the screen doesn't turn, auto-rotate is off. Swipe down from the top and tap Auto-rotate.");
    expect(ORIENT_WORDS.ask).toEqual({
      title: "This one's filmed with your phone on its side.",
      body: 'Let us read which way your phone faces, so the screen turns with it.',
      allow: 'Allow motion & orientation',
      notNow: 'Not now',
    });
    expect(ORIENT_WORDS.turned).toEqual({
      title: 'Your phone turned during the lift',
      body: "So the judges couldn't see it. This one doesn't count against you.",
      filmAgain: 'Film again',
    });
  });
});

describe('on the meet stage', () => {
  const meet = readFileSync(join(__dirname, '../../web/components/meet-attempt.tsx'), 'utf8');
  const css = readFileSync(join(__dirname, '../../web/app/try.css'), 'utf8');
  it('the frame check waits while gravity says the phone faces the wrong way', () => {
    expect(meet).toContain('if (wrong && o.quarter !== null) return void requestAnimationFrame(tick);');
  });
  it('a turn from "Bar is loaded." on voids the attempt, and "Film again" goes back to the frame check', () => {
    expect(meet).toContain('if (loaded && settled !== null && o.watch.quarter !== settled) {');
    expect(meet).toContain("go(voidWhy === 'turned' ? 'lift' : 'refilm')");
    expect(meet).toContain('/turned-void');
  });
  it('the motion step comes once, before the first bench\'s camera', () => {
    expect(meet).toContain("if (bench && !asked && m !== 'sample' && m !== 'resume' && orientRef.current.needsAsk) {");
  });
  it('the drawing is 56 x 96 px, a 2 px outline with a 4 px radius, 600 ms turn and 800 ms hold, three times', () => {
    expect(css).toMatch(/\.phone-draw \{ width: 56px; height: 96px; border: 2px solid var\(--stage-ink\); border-radius: 4px;/);
    expect(css).toContain('animation: phone-turn 1400ms var(--ease-in-out) 3 both;');
    expect(600 / 1400).toBeCloseTo(0.42857, 4);
  });
});
