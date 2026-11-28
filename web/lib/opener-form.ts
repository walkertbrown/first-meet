// "Save my openers" as a plain form (plan 5.23; The Playner, Nov 28): tapped before the page's script ran,
// the browser posts her radios. Barbell: opener-<lift>. Home: weight-<lift> and reps-<lift>.
import type { OpenerPick } from '@/lib/meet-week';
import { LIFTS } from '@/lib/meet';

/** The picks a plain form sent: each lift with a weight picked (a locked lift's fieldset sends nothing). */
export function formPicks(f: FormData): OpenerPick[] | null {
  const num = (k: string) => { const v = f.get(k); return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null; };
  const picks: OpenerPick[] = [];
  for (const lift of LIFTS) {
    const weight = num(`opener-${lift}`) ?? num(`weight-${lift}`);
    if (weight === null) continue;
    picks.push({ lift, weight, reps: num(`reps-${lift}`) });
  }
  return picks.length ? picks : null;
}

