// A meet attempt's words (plan 5.25, 3.5, 3.11, 5.36), exactly, and which ones an attempt's
// state gets. The stage (meet-attempt.tsx) only draws these.
import type { LampState } from '@/components/lamps';

export const MEET_WORDS = {
  soft: { barbell: 'Bar is loaded.', home: 'Weights ready.' },
  squat: 'SQUAT!',
  rack: 'RACK!',
  sending: 'Sending to the judges',
  looking: 'The judges are looking',
  breathe: 'Breathe.',
  breatheBody: "Your lights are on their way. You don't need to do anything.",
  still45: 'Still looking. This one is taking a little longer.',
  busy90: (n: number) => `Busy platform. Your lights in about ${n} minute${n === 1 ? '' : 's'}.`,
  busy90Panel: 'You can declare your next attempt while you wait.',
  slowUpload: 'Your connection is slow. Your lift is saved on this phone while it sends.',
  offlineTitle: 'Your lift is saved on this phone',
  offlineBody: "We'll send it to the judges as soon as you're back online. You can keep this screen open or come back later.",
  noRep: "We didn't see a squat. Try again when you're ready.",
  limit: {
    lifter: "That's 30 demo lifts today, the most for one demo lifter. Come back tomorrow, or watch a meet night.",
    everyone: 'The demo judge is resting until midnight Eastern. You can still watch a meet night and see the referee\'s side.',
  },
  refereeLink: "See the referee's side of this close call",
} as const;

/** 3.5, the reason card: the eyebrow and the meet's sentence. */
export const REASONS: Record<string, { eyebrow: string; text: string }> = {
  depth: { eyebrow: 'DEPTH', text: 'Almost. Your hips stopped just above your knees. Sit back a little further and take it again.' },
  no_lockout: { eyebrow: 'LOCKOUT', text: "You didn't finish standing tall. Next time, stand all the way up and hold still for the command." },
  no_pause: { eyebrow: 'PAUSE', text: "You pressed before the 'Press!' call. Next time, let it rest on your chest, wait for the call, then press." },
  moved_feet: { eyebrow: 'FEET', text: 'Your feet moved during the lift. Keep them planted from the command to the finish.' },
  downward: { eyebrow: 'HITCH', text: 'The weight went down partway up. Next time, pull in one smooth line to standing.' },
  weight_not_shown: { eyebrow: 'WEIGHT', text: "We couldn't see the weight clearly. On your next attempt, turn the plates or dumbbells toward the phone before you start." },
  not_whole_lift: { eyebrow: 'FRAME', text: "We couldn't see the whole lift. Check your spot before your next attempt." },
};

export type MeetResult = {
  title: 'Good lift' | 'No lift' | 'Close call';
  body?: string;
  small?: string;
  reason?: { eyebrow: string; text: string };
  lamps: LampState[];
};

const SQUAT_WHITE = 'Your hips went below your knees and you stood tall. A referee would pass that.';
const RED_BODY = 'Red lights happen to everyone, even world champions. Most women take it again.';
const CLOSE_BODY = 'A referee is looking at this one, usually within 15 minutes. You can take your next attempt while you wait.';

/** 5.25 step 9: what a judged (or close-call) attempt shows. */
export function meetResult(a: { call: 'white' | 'red' | 'close' | null; lights: ('white' | 'red')[] | null; reason: string | null; red_rep: number | null; reps_declared: number | null }): MeetResult | null {
  if (a.call === 'close') return { title: 'Close call', body: CLOSE_BODY, lamps: ['off', 'off', 'off'] };
  if (!a.call) return null;
  const lights = a.lights && a.lights.length === 3 ? a.lights : [a.call, a.call, a.call] as ('white' | 'red')[];
  const whites = lights.filter(l => l === 'white').length;
  const lamps = lights as LampState[];
  const split = whites === 2 ? 'Two white lights and one red. Two whites is a good lift.' : whites === 1 ? 'One white light and two red.' : undefined;
  if (a.call === 'white') {
    const body = a.reps_declared ? `All ${a.reps_declared} reps counted. A referee would pass that.` : SQUAT_WHITE;
    return { title: 'Good lift', body, small: split, lamps };
  }
  const r = REASONS[a.reason ?? ''] ?? REASONS.depth;
  const eyebrow = a.reps_declared && a.red_rep ? `REP ${a.red_rep} · ${r.eyebrow}` : r.eyebrow;
  return { title: 'No lift', reason: { eyebrow, text: r.text }, body: RED_BODY, small: split, lamps };
}

/** The HUD's second line (5.25 step 2): "<card_name> · <age group> · <Division>". */
export const hudLine = (cardName: string, ageGroup: string | null, division: 'barbell' | 'home') =>
  [cardName, ageGroup, division === 'home' ? 'Home' : 'Barbell'].filter(Boolean).join(' · ');

/** The weight on the HUD and card: Barbell "100 lb"; Home reps, "10 reps" (look 5.14b). */
export const loadingLine = (division: 'barbell' | 'home', weight: number, units: 'lb' | 'kg' = 'lb') =>
  division === 'home' ? `One ${weight} ${units} dumbbell` : barLoading(weight, units);

/**
 * "45 lb bar + a blue 45 and a green 25 on each side" (3.x Barbell loading, 5.25 step 1): the
 * greedy split of (weight − bar) / 2, biggest first, colour then number; 55s only above 405 lb;
 * the 5 and 2.5 (2.5 and 1.25 kg) have no colour word.
 */
export function barLoading(weight: number, units: 'lb' | 'kg' = 'lb', bar = units === 'lb' ? 45 : 20) {
  const plates: [number, string][] = units === 'lb'
    ? [...(weight > 405 ? [[55, 'a red 55'] as [number, string]] : []), [45, 'a blue 45'], [35, 'a yellow 35'], [25, 'a green 25'], [10, 'a white 10'], [5, 'a 5'], [2.5, 'a 2½']]
    : [[25, 'a red 25'], [20, 'a blue 20'], [15, 'a yellow 15'], [10, 'a green 10'], [5, 'a white 5'], [2.5, 'a 2½'], [1.25, 'a 1¼']];
  let side = (weight - bar) / 2;
  if (side <= 0) return `${bar} ${units} bar`;
  const got: string[] = [];
  for (const [w, name] of plates) while (side >= w - 1e-9) { got.push(name); side -= w; }
  const list = got.length === 1 ? got[0] : `${got.slice(0, -1).join(', ')} and ${got.at(-1)}`;
  return `${bar} ${units} bar + ${list} on each side`;
}
