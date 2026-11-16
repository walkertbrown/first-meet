// "You totaled" (plan 5.28): the words and numbers the page shows for each of its three states.
// The total itself is web/lib/meet.ts (meetTotal, 3.8); this only words it.
import type { Lift } from '@/db/schema';
import { LIFTS, attemptScore, type MeetAttempt, type Units } from '@/lib/meet';
import { liftCaps, liftLower, liftWord } from '@/lib/stage/meet-words';

type Division = 'barbell' | 'home';
type Link = { label: string; href: string };

const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** A Home lift's score written out (look 5.14b): "25 × 8" for a bell, "2 × 15 × 10" for a pair. */
export function homeScoreText(a: Pick<MeetAttempt, 'weight' | 'repsDeclared' | 'homeLoad'>): string {
  const reps = a.repsDeclared ?? 0;
  return a.homeLoad && a.homeLoad !== a.weight ? `${num(a.homeLoad / a.weight)} × ${num(a.weight)} × ${reps}` : `${num(a.weight)} × ${reps}`;
}

export type TotalLift = { lift: Lift; label: string; value: string; written: string | null };

/** The three lifts under the total, in Number S (Home: "25 × 8" with its score under it). */
export function totalLifts(best: Record<Lift, MeetAttempt>, division: Division): TotalLift[] {
  return LIFTS.map(lift => {
    const a = best[lift];
    return {
      lift, label: liftCaps(lift, division),
      value: num(attemptScore(a, division)),
      written: division === 'home' ? homeScoreText(a) : null,
    };
  });
}

/** Home's Small line under the three lifts: the sum written out. */
export const homeSum = (best: Record<Lift, MeetAttempt>) => LIFTS.map(l => homeScoreText(best[l])).join(' + ');

/** "LB TOTAL" (Barbell) or "LB LIFTED" (Home). */
export const unitLine = (units: Units, division: Division) => `${units.toUpperCase()} ${division === 'home' ? 'LIFTED' : 'TOTAL'}`;

export const formatTotal = num;

export const SOO_LINE = 'That\'s your first total. Soo is live at 8 pm Eastern tonight. Every woman who totaled is on her screen. Watch for your name.';
export const DEMO_LINE = 'That\'s your first total. On a real meet night, every woman who totaled is on the host\'s screen.';

/**
 * The total's words (5.28): a demo lifter isn't in a real meet, so she isn't told Soo will read her
 * name, and the Primary is "See my lifts" until the meet card (phase 4) exists.
 */
export function totalWords(demo: boolean): { body: string; primary: Link; ghost: Link } {
  return {
    body: demo ? DEMO_LINE : SOO_LINE,
    primary: { label: 'See my lifts', href: '/platform' },
    ghost: demo ? { label: 'Watch a meet night', href: '/sample' } : { label: 'Watch meet night', href: '/live' },
  };
}

/** Bombed out (5.28). A demo lifter has no account to add a meet to, so she reads what a real meet would do. */
export function bombedWords(lift: Lift, division: Division, demo: boolean) {
  return {
    body: `Bombed out happens to champions. You didn't get a good ${liftLower(lift, division)} this time, so there's no total, but every lift still counts in your training log.`,
    free: demo ? 'In a real meet, your next meet would be free.' : 'Your next meet is free. We\'ve added it to your account.',
    primary: { label: 'See my lifts', href: '/platform' },
    ghost: totalWords(demo).ghost,
  };
}

/** Waiting on a referee (5.28). */
export const waitingBody = (on: Pick<MeetAttempt, 'lift' | 'number'>, division: Division) =>
  `A referee is still looking at ${liftWord(on.lift, division)} ${on.number}. Your total lands as soon as they're done. Usually within 15 minutes.`;
