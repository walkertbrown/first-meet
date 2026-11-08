import site from '../../content/site.json';

export const SITE = site;

const DAY = 86_400_000;

/** "<N> weeks away", or "<N> days away" under 3 weeks (plan 5.1). */
export function meetAway(now: Date = new Date()): string {
  const ms = new Date(SITE.meet.opensAt).getTime() - now.getTime();
  const days = Math.max(0, Math.ceil(ms / DAY));
  if (days < 21) return days === 1 ? '1 day away' : `${days} days away`;
  const weeks = Math.ceil(days / 7);
  return `${weeks} weeks away`;
}

export const HONEST_LINE = "A prototype built for Love Soo's audience for Hack the Audience 2026.";
