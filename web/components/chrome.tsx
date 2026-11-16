import Link from 'next/link';
import { HONEST_LINE } from '@/lib/site';

export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="wordmark" aria-label="First Meet, home">
      <i aria-hidden="true">
        <b />
        <b />
        <b />
      </i>
      First Meet
    </Link>
  );
}

/** Every public page's footer (plan 5 intro). */
export function Footer() {
  return (
    <footer className="footer">
      <p>{HONEST_LINE}</p>
      <nav aria-label="About First Meet">
        <Link href="/privacy">Privacy</Link>
        <Link href="/rules">Rules</Link>
      </nav>
    </footer>
  );
}

export type LiftIconName = 'squat' | 'bench' | 'deadlift' | 'goblet-squat' | 'overhead-press' | 'floor-press' | 'kettlebell-deadlift';

/** LookieBot's lift icons (look 7), from /lifts.svg. */
export function LiftIcon({ name, size = 24, label }: { name: LiftIconName; size?: 24 | 32; label?: string }) {
  return (
    <svg width={size} height={size} className="icon" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <use href={`/lifts.svg#lift-${name}`} />
    </svg>
  );
}
