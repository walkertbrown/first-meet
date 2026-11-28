// The ticker (plan 5.6): the last 8 lights, newest first, as "<name> · <Lift> <n> · <weight>" with
// their mini lamps. Shared by /live and the sample meet (5.3).
import type { Lift } from '@/db/schema';
import type { Division, LampCall } from '@/lib/board';
import { MiniLamps } from './board';

export type TickerItem = {
  id: string; name: string; division: Division; lift: Lift; number: number;
  weight: number; reps: number | null; units: string; lamps: LampCall[];
};

const LIFT_WORD: Record<Lift, [string, string]> = { squat: ['Squat', 'Goblet squat'], bench: ['Bench', 'Press'], deadlift: ['Deadlift', 'Deadlift'] };
const n = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 1 });

export const tickerLine = (t: TickerItem) =>
  `${t.name} · ${LIFT_WORD[t.lift][t.division === 'home' ? 1 : 0]} ${t.number} · ${t.division === 'home' && t.reps != null ? `${n(t.weight)} × ${t.reps}` : `${n(t.weight)} ${t.units}`}`;

export function Ticker({ items, label = 'Latest lights' }: { items: TickerItem[]; label?: string }) {
  return (
    <ol className="ticker" aria-label={label}>
      {items.map(t => (
        <li key={t.id}><MiniLamps lamps={t.lamps} /><span>{tickerLine(t)}</span></li>
      ))}
    </ol>
  );
}
