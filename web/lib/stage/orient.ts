// Which way the phone stands (plan 3.10, look 4a and 4b): tall for the standing lifts, on its side for the
// Barbell bench. The phone reads it from gravity (the motion sensor), not from the screen, so rotation lock
// can't break it. Pure numbers here; the browser hook is use-gravity.ts.
export type Way = 'tall' | 'side';
/** Which way up the phone's top points, in degrees from upright: 0, 90 (its top turned to her left), -90, 180. */
export type Quarter = 0 | 90 | -90 | 180;

/** Only the Barbell bench is filmed on its side; the Home press stands (plan item 62). */
export function wayFor(lift: string, division: 'barbell' | 'home'): Way {
  return lift === 'bench' && division === 'barbell' ? 'side' : 'tall';
}

export const wayOf = (q: Quarter): Way => (q === 90 || q === -90 ? 'side' : 'tall');

/**
 * The phone's tilt in the screen's plane, from `accelerationIncludingGravity`: 0 upright, +90 with its top
 * turned to the left (the spec's x = +9.8), -90 to the right, ±180 upside down. `sign` is -1 where the
 * platform reports the axes the other way round (some iPhones).
 */
export function tiltDeg(x: number, y: number, sign: 1 | -1 = 1): number {
  return (Math.atan2(sign * x, sign * y) * 180) / Math.PI;
}

/** The shortest turn between two angles, in degrees (0–180). */
export function apart(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

export function nearestQuarter(deg: number): Quarter {
  const qs: Quarter[] = [0, 90, -90, 180];
  return qs.reduce((best, q) => (apart(deg, q) < apart(deg, best) ? q : best), 0 as Quarter);
}

const G = 9.81;
/** Look 4b: it follows gravity once it has held for 500 ms past 60° from the way it was. */
export const TURN_DEG = 60;
export const TURN_HOLD_MS = 500;

/**
 * Gravity, sample by sample. `quarter` is the way the phone settled: it changes only once the tilt has
 * stayed more than 60° from it for 500 ms, so a bump never turns it. A phone lying flat (under half of
 * gravity in the screen's plane) says nothing about which way it stands, and its samples are skipped.
 */
export class GravityWatch {
  quarter: Quarter | null = null;
  deg: number | null = null;
  /** -1 where the axes come the other way round; learned from the first upright samples. */
  sign: 1 | -1;
  private learned = false;
  private away: { q: Quarter; since: number } | null = null;

  constructor(guessSign: 1 | -1 = 1) { this.sign = guessSign; }

  /** One `devicemotion` sample; returns true when `quarter` changed. */
  feed(x: number | null | undefined, y: number | null | undefined, t: number): boolean {
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (Math.hypot(x, y) < 0.5 * G) return false;
    // standing up tall with the screen to her, gravity runs along y: its sign there sets the axes' sign
    if (!this.learned && Math.abs(y) > 0.8 * G && Math.abs(x) < 0.3 * G) {
      this.sign = y > 0 ? 1 : -1;
      this.learned = true;
    }
    const deg = tiltDeg(x, y, this.sign);
    this.deg = deg;
    const from = this.quarter;
    const q = nearestQuarter(deg);
    // the first way it settles is the nearest quarter held for 500 ms; after that, 60° off it for 500 ms
    const off = from === null || apart(deg, from) > TURN_DEG;
    if (!off) { this.away = null; return false; }
    if (!this.away || this.away.q !== q) this.away = { q, since: t };
    if (t - this.away.since < TURN_HOLD_MS) return false;
    this.away = null;
    this.quarter = q;
    return q !== from;
  }

  get way(): Way | null { return this.quarter === null ? null : wayOf(this.quarter); }
}

/** Look 4b: the content turns the opposite way to the phone, so her eyes read it upright. */
export function screenTurn(q: Quarter): 0 | 90 | -90 {
  return q === 90 ? 90 : q === -90 ? -90 : 0;
}

export type PhoneKind = 'iphone' | 'android' | null;
export function phoneKind(ua: string, motionAsks: boolean): PhoneKind {
  if (motionAsks || /iPhone|iPad|iPod/.test(ua)) return 'iphone';
  if (/Android/.test(ua)) return 'android';
  return null;
}

/** The plan's words (3.10, look 4a and 4b). */
export const ORIENT_WORDS = {
  turn: { side: 'Turn your phone on its side for this one.', tall: 'Stand your phone up tall again for this one.' } as Record<Way, string>,
  lock: {
    iphone: "If the screen doesn't turn, rotation lock is on. Swipe down from the top-right corner and tap the lock, then turn your phone again.",
    android: "If the screen doesn't turn, auto-rotate is off. Swipe down from the top and tap Auto-rotate.",
  },
  ask: {
    title: "This one's filmed with your phone on its side.",
    body: 'Let us read which way your phone faces, so the screen turns with it.',
    allow: 'Allow motion & orientation',
    notNow: 'Not now',
  },
  turned: {
    title: 'Your phone turned during the lift',
    body: "So the judges couldn't see it. This one doesn't count against you.",
    filmAgain: 'Film again',
  },
} as const;
