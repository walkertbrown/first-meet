// The certificate (plan 5.30 Print, look 9): US Letter, ink on chalk. Its words and its attempt sheet,
// all nine attempts in a Board-row table. A printer can't print light, so each lamp is a ring with
// "white light" under it, and each attempt says what its lights were in words.
import { LIFTS } from '@/lib/meet';
import type { Lift } from '@/db/schema';
import { liftName, weightText } from '@/lib/referee-view';
import type { CardView } from '@/lib/card/card-view';

export type SheetAttempt = { lift: Lift; number: number; weight: number; repsDeclared: number | null; call: 'white' | 'red' | 'close' | null; status?: string };
export type SheetCell = { weight: string; result: 'Good lift' | 'No lift' } | null;
export type SheetRow = { lift: string; cells: [SheetCell, SheetCell, SheetCell] };

export const CERT = {
  lampWord: 'white light',
  quote: 'Not chasing after skinny, chasing after STRONG.',
  quoteBy: 'Love Soo, on YouTube',
  heads: ['Lift', 'Attempt 1', 'Attempt 2', 'Attempt 3'] as const,
};

/** Squat, bench, deadlift (Home's names on Home), each with its three attempts; one not taken is empty. */
export function attemptSheet(list: SheetAttempt[], division: string, units: string): SheetRow[] {
  return LIFTS.map(lift => {
    const cell = (n: number): SheetCell => {
      // a voided attempt was retaken (3.6), so the slot's latest live attempt is the one that counted
      const a = list.filter(x => x.lift === lift && x.number === n && x.status !== 'void').at(-1);
      if (!a || (a.call !== 'white' && a.call !== 'red')) return null;
      return { weight: weightText(a.weight, units, a.repsDeclared), result: a.call === 'white' ? 'Good lift' : 'No lift' };
    };
    return { lift: liftName(lift, division), cells: [cell(1), cell(2), cell(3)] };
  });
}

export type Certificate = Pick<CardView, 'name' | 'meta' | 'season' | 'total' | 'unitLine' | 'nineForNine' | 'lifts'> & { sheet: SheetRow[] };
