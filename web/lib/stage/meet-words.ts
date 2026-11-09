// A meet attempt's words (plan 5.25, 3.5, 3.11, 5.36), exactly, and which ones an attempt's
// state gets. The stage (meet-attempt.tsx) only draws these.
import type { LampState } from '@/components/lamps';
import { REASON_EYEBROW, reasonEyebrow, reasonSentence, type ReasonCode } from '@/lib/reason-words';
import { PLAN_SWITCHES } from '@/lib/plan-switches';

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

export type MeetResult = {
  title: 'Good lift' | 'No lift' | 'Close call';
  body?: string;
  small?: string;
  reason?: { eyebrow: string; text: string };
  lamps: LampState[];
};

/** 5.25 step 9: the good-lift sentence for each lift (Barbell; Home says its reps). */
export const WHITE_SENTENCE: Record<string, string> = {
  squat: 'Your hips went below your knees and you stood tall. A referee would pass that.',
  bench: 'It touched, you waited for the call, and you locked out. A referee would pass that.',
  deadlift: 'You stood tall with your hips and knees locked. A referee would pass that.',
};
const RED_BODY = 'Red lights happen to everyone, even world champions. Most women take it again.';
const CLOSE_BODY = 'A referee is looking at this one, usually within 15 minutes. You can take your next attempt while you wait.';

/** 5.25 step 9: what a judged (or close-call) attempt shows. */
export function meetResult(a: { call: 'white' | 'red' | 'close' | null; lights: ('white' | 'red')[] | null; reason: string | null; red_rep: number | null; reps_declared: number | null; lift?: string; shown_lift?: string }): MeetResult | null {
  // a sample lift's words are for the lift the clip shows (5.36)
  const lift = a.shown_lift ?? a.lift ?? 'squat';
  if (a.call === 'close') return { title: 'Close call', body: CLOSE_BODY, lamps: ['off', 'off', 'off'] };
  if (!a.call) return null;
  const lights = a.lights && a.lights.length === 3 ? a.lights : [a.call, a.call, a.call] as ('white' | 'red')[];
  const whites = lights.filter(l => l === 'white').length;
  const lamps = lights as LampState[];
  const split = whites === 2 ? 'Two white lights and one red. Two whites is a good lift.' : whites === 1 ? 'One white light and two red.' : undefined;
  if (a.call === 'white') {
    const body = a.reps_declared ? `All ${a.reps_declared} reps counted. A referee would pass that.` : (WHITE_SENTENCE[lift] ?? WHITE_SENTENCE.squat);
    return { title: 'Good lift', body, small: split, lamps };
  }
  const code = (a.reason && a.reason in REASON_EYEBROW ? a.reason : 'depth') as ReasonCode;
  const home = !!a.reps_declared;
  const reason = { eyebrow: reasonEyebrow(code, home ? a.red_rep : null), text: reasonSentence(code, lift, home ? 'home' : 'barbell') };
  return { title: 'No lift', reason, body: RED_BODY, small: split, lamps };
}

/** The HUD's second line (5.25 step 2): "<card_name> · <age group> · <Division>". */
export const hudLine = (cardName: string, ageGroup: string | null, division: 'barbell' | 'home') =>
  [cardName, ageGroup, division === 'home' ? 'Home' : 'Barbell'].filter(Boolean).join(' · ');

/**
 * The card's loading line (5.25 step 1): Barbell "45 lb bar + a blue 45 and a 2½ on each side";
 * Home "One 25 lb dumbbell" (the goblet squat's one bell) or "Two 15 lb dumbbells" (a pair).
 */
export const loadingLine = (division: 'barbell' | 'home', weight: number, units: 'lb' | 'kg' = 'lb', lift = 'squat', kind?: 'pair' | 'bell') =>
  division === 'home' ? homeWeightsLine(weight, units, lift, kind) : barLoading(weight, units);

/** A Home lift's weights: the overhead press is always a pair; the deadlift a pair unless she owns it as one bell. */
export const homeWeightsLine = (weight: number, units: 'lb' | 'kg', lift: string, kind?: 'pair' | 'bell') =>
  lift === 'bench' || (lift === 'deadlift' && kind !== 'bell') ? `Two ${weight} ${units} dumbbells` : `One ${weight} ${units} dumbbell`;

// ---------- the lifts ----------

/** The HUD and card's lift name (5.25 step 1, 3.7): "SQUAT", "GOBLET SQUAT". */
export const LIFT_CAPS: Record<string, { barbell: string; home: string }> = {
  squat: { barbell: 'SQUAT', home: 'GOBLET SQUAT' },
  bench: { barbell: 'BENCH PRESS', home: 'OVERHEAD PRESS' },
  deadlift: { barbell: 'DEADLIFT', home: 'DEADLIFT' },
};
/** The lift in a sentence ("Next: Bench press", "Bench press 2 is on your card."). */
export const LIFT_WORDS: Record<string, { barbell: string; home: string }> = {
  squat: { barbell: 'Squat', home: 'Goblet squat' },
  bench: { barbell: 'Bench press', home: 'Overhead press' },
  deadlift: { barbell: 'Deadlift', home: 'Deadlift' },
};
export const liftCaps = (lift: string, division: 'barbell' | 'home') => (LIFT_CAPS[lift] ?? LIFT_CAPS.squat)[division];
export const liftWord = (lift: string, division: 'barbell' | 'home') => (LIFT_WORDS[lift] ?? LIFT_WORDS.squat)[division];
/** Inside a sentence: "Your second bench press". */
export const liftLower = (lift: string, division: 'barbell' | 'home') => liftWord(lift, division).toLowerCase();

/**
 * 5.25 steps 5 and 7: the commands, in order. Squat "SQUAT!"; bench "START!" then "PRESS!"; the
 * overhead press (Home's press) "START!"; the deadlift none. The end is "RACK!", or "DOWN!" for
 * the deadlift.
 */
export function liftCommands(lift: string, division: 'barbell' | 'home'): { calls: string[]; end: string } {
  if (lift === 'bench') return division === 'home' ? { calls: ['START!'], end: 'RACK!' } : { calls: ['START!', 'PRESS!'], end: 'RACK!' };
  if (lift === 'deadlift') return { calls: [], end: 'DOWN!' };
  return { calls: ['SQUAT!'], end: 'RACK!' };
}

/** The commands' words on the stage (5.25 steps 5 and 7), by `command_times` key's word. */
export const COMMAND_TEXT = { squat: 'SQUAT!', start: 'START!', press: 'PRESS!', rack: 'RACK!', down: 'DOWN!' } as const;

/** No lift was seen (5.25; the squat's line, for each lift): "We didn't see a bench press." */
export function noRepLine(lift: string, division: 'barbell' | 'home') {
  const w = liftLower(lift, division);
  return `We didn't see ${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w}. Try again when you're ready.`;
}

/** 5.25 step 11: the panel's button once the lights are in. */
export function nextButton(lift: string, number: number, division: 'barbell' | 'home') {
  if (number < 3) return 'Declare your next attempt';
  if (lift === 'squat') return `Next: ${liftWord('bench', division)}`;
  if (lift === 'bench') return `Next: ${liftWord('deadlift', division)}`;
  return 'See your total';
}

// ---------- declaring (5.26) ----------

const ORDINAL = ['first', 'second', 'third'];
/** 5.26's "Take it again" fix, by reason (3 words at most). */
const FIX_1_12: Record<string, string> = { depth: 'deeper', no_lockout: 'lock out', no_pause: "wait for 'Press!'" };
/** Item 75 adds a fix for every other reason. */
const FIX_75: Record<string, string> = { moved_feet: 'feet planted', downward: 'one smooth line', weight_not_shown: 'show the weight', not_whole_lift: 'check your spot' };
export const reasonFix = (reason: string | null, item75 = PLAN_SWITCHES.item75): string | null =>
  (reason && (FIX_1_12[reason] ?? (item75 ? FIX_75[reason] : undefined))) ?? null;

/** Item 75: under "SAMPLE LIFT" and the result's sentence, when a squat clip stands in for another lift. */
export const standInLine = (shownLift: string, lift: string, division: 'barbell' | 'home') =>
  `This sample is a ${liftLower(shownLift, division)}, standing in for your ${liftLower(lift, division)}.`;

export const DECLARE_WORDS = {
  title: (lift: string, number: number, division: 'barbell' | 'home') => `Your ${ORDINAL[number - 1]} ${liftLower(lift, division)}`,
  bodyWhite: 'Pick one. Rest as long as you like before you lift it.',
  bodyRed: RED_BODY,
  declaring: 'Declaring',
  ok: 'OK',
  declaredTitle: (lift: string, number: number, division: 'barbell' | 'home') => `${liftWord(lift, division)} ${number} is on your card.`,
  declaredBody: (division: 'barbell' | 'home', loading: string) => division === 'home'
    ? `Pick up your ${loading.replace(/^One /, '').replace(/^Two /, '')}. Rest, drink some water, and tap “I'm ready” when you are.`
    : `Load ${loading}. Rest, drink some water, and tap “I'm ready” when you are.`,
} as const;

export type ChoiceWords = { label: string; line: string };
/** One choice card's words (5.26). `value` is the weight, or the reps on Home. */
export function choiceWords(c: { key: string; value: number; disabled: boolean }, o: {
  division: 'barbell' | 'home'; lift: string; units: 'lb' | 'kg'; last: number; cap: number; reason: string | null;
}): ChoiceWords {
  const home = o.division === 'home';
  const fix = reasonFix(o.reason);
  if (c.disabled) return {
    label: labelFor(c.key, c.value, home),
    line: home ? `Above your best judged set (${o.cap} reps)` : `Above your best judged ${liftLower(o.lift, o.division)} (${o.cap})`,
  };
  const step = Math.round((c.value - o.last) * 1000) / 1000;
  switch (c.key) {
    // the 1:12 AM copy names no fix for four reasons; then the line is the plain "Same weight"
    case 'again': return { label: 'Take it again', line: `${home ? 'Same reps' : 'Same weight'}${fix ? `, ${fix}` : ''}` };
    case 'same': return home ? { label: 'Same reps', line: `${c.value} reps again` } : { label: 'Same weight', line: `${c.value} again` };
    case 'small': return home ? { label: 'A small step', line: `${c.value} reps` } : { label: 'A small step', line: `+${step} ${o.units}` };
    case 'bigger': return home ? { label: 'A bigger step', line: `${c.value} reps` } : { label: 'A bigger step', line: `+${step} ${o.units}` };
    default: return { label: 'Your cap', line: `${c.value} · your best judged ${liftLower(o.lift, o.division)}` };
  }
}
const labelFor = (key: string, value: number, home: boolean) =>
  ({ again: 'Take it again', same: home ? 'Same reps' : 'Same weight', small: 'A small step', bigger: 'A bigger step', cap: 'Your cap' } as Record<string, string>)[key] ?? String(value);

/** 5.26's cap line under the choices. */
export function capLine(o: { division: 'barbell' | 'home'; lift: string; number: number; cap: number; judged: boolean; weight: number; units: 'lb' | 'kg' }) {
  const lift = liftLower(o.lift, o.division);
  const nth = ORDINAL[o.number - 1];
  if (o.division === 'home') return `Your ${nth} ${lift} can go up to ${o.cap} reps at ${o.weight} ${o.units}, your best judged set. Never above it.`;
  return `Your ${nth} ${lift} can go up to ${o.cap}, your best${o.judged ? ' judged' : ''} training ${lift}. Never above it.`;
}

/** 5.26's primary: "Declare 110 lb" / "Declare 11 reps". */
export const declareButton = (division: 'barbell' | 'home', value: number, units: 'lb' | 'kg') =>
  division === 'home' ? `Declare ${value} reps` : `Declare ${value} ${units}`;

/**
 * "45 lb bar + a blue 45 and a green 25 on each side" (3.x Barbell loading, 5.25 step 1): the
 * greedy split of (weight − bar) / 2, biggest first, colour then number; 55s only above 405 lb;
 * the 5 and 2.5 (2.5 and 1.25 kg) have no colour word.
 */
const PLATE_NAMES = {
  lb: { 55: 'a red 55', 45: 'a blue 45', 35: 'a yellow 35', 25: 'a green 25', 10: 'a white 10', 5: 'a 5', 2.5: 'a 2½' } as Record<number, string>,
  kg: { 25: 'a red 25', 20: 'a blue 20', 15: 'a yellow 15', 10: 'a green 10', 5: 'a white 5', 2.5: 'a 2½', 1.25: 'a 1¼' } as Record<number, string>,
};
export const barOf = (units: 'lb' | 'kg') => (units === 'lb' ? 45 : 20);

/** The plates on each side, biggest first: the greedy split (55s only above 405 lb). */
export function platesPerSide(weight: number, units: 'lb' | 'kg' = 'lb', bar = barOf(units)): number[] {
  const sizes = units === 'lb' ? [...(weight > 405 ? [55] : []), 45, 35, 25, 10, 5, 2.5] : [25, 20, 15, 10, 5, 2.5, 1.25];
  let side = (weight - bar) / 2;
  const got: number[] = [];
  for (const w of sizes) while (side >= w - 1e-9) { got.push(w); side -= w; }
  return got;
}

export function barLoading(weight: number, units: 'lb' | 'kg' = 'lb', bar = barOf(units)) {
  const got = platesPerSide(weight, units, bar).map(w => PLATE_NAMES[units][w]);
  if (!got.length) return `${bar} ${units} bar`;
  const list = got.length === 1 ? got[0] : `${got.slice(0, -1).join(', ')} and ${got.at(-1)}`;
  return `${bar} ${units} bar + ${list} on each side`;
}

/** Weight XL's width in digits (look 5.6 row 2): a decimal point counts .35 of a digit, so "62.5" is 3.35. */
export const weightDigits = (n: number) => {
  const s = String(n);
  return s.replace('.', '').length + (s.includes('.') ? 0.35 : 0);
};

/** The refused-upload sheet (3.11). */
export const REFUSED_WORDS = {
  title: "Your clip didn't send",
  body: "Nothing was judged, so this attempt is still yours. Lift it again when you're ready.",
} as const;

/** Under "SAMPLE LIFT" on a Home attempt (5.36). */
export const sampleRepsLine = (n: number) =>
  n === 1 ? "This sample is one rep, so it's judged as one." : `This sample is ${n} reps, so it's judged as ${n}.`;
