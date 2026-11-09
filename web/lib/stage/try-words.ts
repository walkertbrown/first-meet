// Try a lift's words (plan 5.2, steps 3–5), exactly, and which result a call gets.
import type { AttemptResult } from '@/lib/judge';
import type { LampState } from '@/components/lamps';
import { keepWhole } from '@/lib/site';

export type Outcome = 'good' | 'depth' | 'no_lockout' | 'close' | 'unseen';

export const STAGE_WORDS = {
  goodSpot: 'Good spot.',
  standTall: 'Stand tall and still.',
  squat: 'Squat!',
  rack: 'Rack!',
  noRep: "We didn't see a squat. Try again when you're ready.",
  looking: 'The judge is looking',
  // The panel during the held breath (look 9 step 8; plan 5.2 step 4 follows it).
  breathe: 'Breathe.',
  breatheBody: "Your lights are on their way. You don't need to do anything.",
  slowModel: 'Getting the judge ready. This takes a few seconds the first time.',
} as const;

export type ResultWords = { title: string; body?: string; reason?: { label: string; text: string } };

export const RESULT_WORDS: Record<Outcome, ResultWords> = {
  good: {
    title: 'Good lift',
    body: "Your hips went below your knees and you stood tall. That's a squat a referee would pass.",
  },
  depth: {
    title: 'No lift',
    reason: { label: 'Depth', text: 'Almost. Your hips stopped just above your knees. Sit back a little further and try again.' },
  },
  no_lockout: {
    title: 'No lift',
    reason: { label: 'Lockout', text: "You didn't finish standing tall. Stand all the way up and hold still for the command." },
  },
  close: {
    title: 'Too close to call',
    body: 'That one was right on the line. In a meet, a referee would decide it. Try once more and sit a little deeper.',
  },
  unseen: {
    title: "We couldn't see that one",
    body: "We couldn't see you well enough to judge it. Check your spot and try again.",
  },
};

/** The result a call gets. A visibility close call is "We couldn't see that one"; any other close call is "Too close to call". */
export function outcomeOf(r: AttemptResult): Outcome {
  const c = r.call;
  if (c.light === 'white') return 'good';
  if (c.light === 'red') return c.reason === 'depth' ? 'depth' : 'no_lockout';
  return c.reason === 'visibility' ? 'unseen' : 'close';
}

/** The three lamps for a result. Close calls and "couldn't see" keep the lamps dark, with no pulse. */
export function lampsOf(o: Outcome): LampState[] {
  if (o === 'good') return ['white', 'white', 'white'];
  if (o === 'depth' || o === 'no_lockout') return ['red', 'red', 'red'];
  return ['off', 'off', 'off'];
}

/** The marks' colour on the judged frame (look 9, step 10). */
export function markColour(o: Outcome): string {
  if (o === 'good') return 'var(--lamp-white)';
  if (o === 'depth' || o === 'no_lockout') return 'var(--lamp-red)';
  return 'var(--stage-ink-2)';
}

/** "Winter meet · Feb 26–27 · <N> weeks away." */
export const meetLineBold = (short: string, dates: string, away: string) => `${short} · ${keepWhole(dates)} · ${away}.`;
