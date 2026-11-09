// A meet attempt's words (plan 5.25, 3.5, 3.11, 5.36), exactly, and which ones an attempt's
// state gets. The stage (meet-attempt.tsx) only draws these.
import type { LampState } from '@/components/lamps';
import { REASON_EYEBROW, reasonEyebrow, reasonSentence, type ReasonCode } from '@/lib/reason-words';

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
  /** 5.25 step 8 (item 87): judging paused (3.9 step 9) at or after 90 s, with no minutes */
  paused90: "Judging is paused for a moment. Your lift is saved and will be judged when it's back.",
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
/** 5.34, on #home-press A (3.4c). */
export const HOME_PRESS_WHITE = "Your arms pressed up overhead, nearly straight, and you held them there. That's a good lift at First Meet.";
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
    // 5.34 (#home-press A): the Home overhead press has its own good-lift sentence
    const body = a.reps_declared ? (lift === 'bench' ? HOME_PRESS_WHITE : `All ${a.reps_declared} reps counted. A referee would pass that.`) : (WHITE_SENTENCE[lift] ?? WHITE_SENTENCE.squat);
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

/**
 * 5.25 step 3 (item 89): the lift's set-up line, the stage's first line at "Find your spot". The
 * Home overhead press (5.34, 3.4c) and the Barbell bench (3.10) have one; squat, goblet squat and
 * deadlift have none.
 */
export const SETUP_LINES = {
  press: 'Face the phone, with room above your head.',
  bench: 'Turn your phone on its side on the floor, level with the bench, against a mug or a shoe.',
} as const;
export function setupLine(lift: string, division: 'barbell' | 'home'): string | null {
  if (lift !== 'bench') return null;
  return division === 'home' ? SETUP_LINES.press : SETUP_LINES.bench;
}

/**
 * The one spot line the stage shows (5.25 step 3, item 89). The set-up line stays until the frame
 * check gives a line of its own: from the first frame it sees her in (`seen`), its line replaces
 * the set-up line on that same frame, and the set-up line doesn't come back. While nobody is in
 * frame she is still placing the phone, so the set-up line stands in for "Step back until we can
 * see your feet.". Without a set-up line, the frame check's line as before.
 */
export function spotLineShown(setup: string | null, seenYet: boolean, frameLine: string | null): string | null {
  return setup && !seenYet ? setup : frameLine;
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
/** 5.26's "Take it again" fix, by reason (3 words at most): every red reason has one. */
const FIX: Record<string, string> = {
  depth: 'deeper', no_lockout: 'lock out', no_pause: "wait for 'Press!'",
  moved_feet: 'feet planted', downward: 'one smooth line', weight_not_shown: 'show the weight', not_whole_lift: 'check your spot',
};
export const reasonFix = (reason: string | null): string | null => (reason && FIX[reason]) ?? null;

/** Under "SAMPLE LIFT" and the result's sentence, when a squat clip stands in for another lift. */
export const standInLine = (shownLift: string, lift: string, division: 'barbell' | 'home') =>
  `This sample is a ${liftLower(shownLift, division)}, standing in for your ${liftLower(lift, division)}.`;

/** The demo's welcome sheet (5.36), before her first look at the platform. */
export const WELCOME_WORDS = {
  title: 'Welcome to the demo meet',
  body: 'You have three attempts at each lift. Your openers are already chosen from a made-up training history, so you can lift right away. No camera, or no weights? Use a sample lift on any attempt.',
  corner: 'Friends can follow along and cheer on your corner page.',
  /** item 78: the short label; the new-tab mark and openCornerSaid say it opens a new tab */
  openCorner: 'Open my corner page',
  openCornerSaid: 'Open my corner page, opens in a new tab',
  go: 'Go to the platform',
} as const;

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
    // with no reason to fix (or one not in FIX), the line is the plain "Same weight"
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

/** The because line's second sentence, judged (5.25 step 1; item 76 when she's at her cap). */
export function capSentence(division: 'barbell' | 'home', same: boolean): string {
  if (division === 'home') return same ? 'This one is the same number, so it\'s already yours.' : 'This one is fewer, so it\'s already yours.';
  return same ? 'This one is the same weight for just one, so it\'s already yours.' : 'This one is lighter, so it\'s already yours.';
}

// ---------- the meet window (3.8, 3.11, 5.28; item 85) ----------

const clock = (d: Date, timeZone: string | undefined, weekday: boolean) =>
  d.toLocaleString('en-US', { ...(weekday ? { weekday: 'long' as const } : {}), hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) })
    .replace(':00', '').replace(' AM', ' am').replace(' PM', ' pm');

/**
 * A meet time as 5.24 writes it: Eastern first, then her own time in brackets when it differs
 * ("6 pm Eastern (3 pm)"). `weekday` names the day ("Sunday 12 am Eastern (Saturday 9 pm)"); without
 * it her time still names its day when that isn't Eastern's. `local`: her time zone (the phone's
 * own when left out); null on the server, which doesn't know it, writes Eastern alone.
 */
export function windowTime(iso: string, o: { weekday?: boolean; local?: string | null } = {}): string {
  const d = new Date(iso);
  const et = clock(d, 'America/New_York', !!o.weekday);
  if (o.local === null) return `${et} Eastern`;
  const sameDay = clock(d, 'America/New_York', true).split(' ')[0] === clock(d, o.local, true).split(' ')[0];
  const local = clock(d, o.local, !!o.weekday || !sameDay);
  return `${et} Eastern${local !== et ? ` (${local})` : ''}`;
}

/** 3.11's two sheets, and what her Primary does. With no judged lift, "OK" goes to the closed page. */
export const WINDOW_WORDS = {
  closedTitle: 'The platform has closed',
  closedBody: (closesAt: string, local?: string | null) =>
    `It closed at ${windowTime(closesAt, { local })}, before this lift started, so this one isn't judged. Your judged lifts stand.`,
  lateTitle: 'Your clip arrived too late',
  lateBody: (deadline: string, local?: string | null) =>
    `The judges took clips until ${windowTime(deadline, { weekday: true, local })}, and this one didn't reach us in time, so it isn't judged. Your judged lifts stand.`,
  seeTotal: 'See your total',
  ok: 'OK',
};

/** 5.28 "Waiting on your clip": her clip still sending after the close. */
export const waitingClipBody = (on: { lift: string; number: number }, division: 'barbell' | 'home', deadline: string, local?: string | null) =>
  `Your ${liftWord(on.lift, division)} ${on.number} is still sending from your phone. Keep First Meet open with a connection, and your total lands once it's judged. Clips count until ${windowTime(deadline, { weekday: true, local })}.`;

/**
 * 5.28 "Waiting on the judges": after the close, her clip has reached us (`queued` or `judging`)
 * with no lights yet. With an estimated wait (3.9 step 8) of 2 minutes or more, the second
 * sentence gives it.
 */
export const judgingClipBody = (on: { lift: string; number: number }, division: 'barbell' | 'home', waitMin: number | null = null, paused = false) =>
  paused
    // 3.9 step 9 (item 87): no minutes while judging is paused
    ? `Your ${liftWord(on.lift, division)} ${on.number} reached us and is saved. Judging is paused for a moment, and your total lands once it's back. You don't need to keep First Meet open.`
    : `Your ${liftWord(on.lift, division)} ${on.number} reached us, and the judges are looking. ` +
  (waitMin !== null && waitMin >= 2 ? `Your total lands once it's judged, in about ${waitMin} minutes.` : `Your total lands once it's judged, usually within a minute.`) +
  ` You don't need to keep First Meet open.`;

/** 3.8: a late clip raised her total. "Your Squat 3 landed after the close, so your total changed." */
export const lateLine = (on: { lift: string; number: number }, division: 'barbell' | 'home') =>
  `Your ${liftWord(on.lift, division)} ${on.number} landed after the close, so your total changed.`;

/** Her lifts lists' Small line for a `void` attempt (3.8): "Not judged · after the close" / "… sent too late". */
export function notJudgedLine(reason: string | null | undefined): string {
  if (reason === 'after_close') return 'Not judged · after the close';
  if (reason === 'upload_late') return 'Not judged · sent too late';
  return 'Not judged';
}

/** A screen reader's words for a not-judged slot on the row (look 4): "<Lift> <n>, not judged, after the close". */
export const notJudgedLabel = (lift: string, n: number, reason: string | null | undefined) =>
  `${lift} ${n}, not judged${reason === 'after_close' ? ', after the close' : reason === 'upload_late' ? ', sent too late' : ''}`;
