import site from '../../content/site.json';

export const SITE = site;

const DAY = 86_400_000;
const NBSP = '\u00A0', WJ = '\u2060';
const NAMES = 'Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';

/**
 * A date, a number with its unit, and a time never break across a line (look 4, type):
 * "Feb 26–27", "Fri Feb 26 – Sat Feb 27", "16 weeks", "8 pm". No-break spaces, and word
 * joiners around a dash between numbers.
 */
export function keepWhole(s: string): string {
  return s
    .replace(/(\d)([–-])(\d)/g, `$1${WJ}$2${WJ}$3`)
    .replace(/(\d) – (?=[A-Z\d])/g, `$1${NBSP}–${NBSP}`)
    .replace(new RegExp(`\\b(${NAMES}) (?=[A-Z\\d])`, 'g'), `$1${NBSP}`)
    .replace(/(\d) (?=[A-Za-z])/g, `$1${NBSP}`);
}

/** "<N> weeks away", or "<N> days away" under 3 weeks (plan 5.1). */
export function meetAway(now: Date = new Date()): string {
  const ms = new Date(SITE.meet.opensAt).getTime() - now.getTime();
  const days = Math.max(0, Math.ceil(ms / DAY));
  if (days < 21) return keepWhole(days === 1 ? '1 day away' : `${days} days away`);
  const weeks = Math.ceil(days / 7);
  return keepWhole(`${weeks} weeks away`);
}

export const HONEST_LINE = "A prototype built for Love Soo's audience for Hack the Audience 2026.";
