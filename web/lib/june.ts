// June Okafor, the robot demo lifter (plan 5.36): her corner page is /corner/demo. She lifts an
// attempt every 30 s in a loop (9 attempts, a total, then 2 minutes later a fresh meet), with
// lights replayed from stored results. Nothing is written and no Workflow runs: the clock alone
// says where she is, so every viewer sees the same meet.
import type { Lift } from '@/db/schema';
import { ORDER } from '@/lib/meet';

export const JUNE = { cardName: 'June Okafor', division: 'barbell', units: 'lb' } as const;

type Light = 'white' | 'red';
/** Her nine, in the meet's order: the weight and the three referee lights each one got. */
export const JUNE_NINE: { weight: number; lights: [Light, Light, Light] }[] = [
  { weight: 135, lights: ['white', 'white', 'white'] },
  { weight: 145, lights: ['white', 'red', 'white'] },
  { weight: 155, lights: ['red', 'red', 'white'] },
  { weight: 85, lights: ['white', 'white', 'white'] },
  { weight: 90, lights: ['white', 'white', 'white'] },
  { weight: 95, lights: ['red', 'red', 'red'] },
  { weight: 185, lights: ['white', 'white', 'white'] },
  { weight: 200, lights: ['white', 'white', 'white'] },
  { weight: 210, lights: ['white', 'red', 'white'] },
];

/** Seconds: an attempt is "with the judges" from 30k + 10 and its lights land at 30k + 30. */
export const JUNE_STEP_S = 30;
export const JUNE_SENT_AT_S = 10;
export const JUNE_REST_S = 120;
export const JUNE_CYCLE_S = ORDER.length * JUNE_STEP_S + JUNE_REST_S; // 390

export type JuneAttempt = { id: string; lift: Lift; number: number; weight: number; status: 'judging' | 'judged'; call: Light | null; lights: Light[] };

const callOf = (l: Light[]): Light => (l.filter(x => x === 'white').length >= 2 ? 'white' : 'red');

/** Where June's meet is at `now`: her attempts so far, and when the next change comes (epoch ms). */
export function juneAt(now: Date = new Date()) {
  const ms = now.getTime();
  const cycleMs = JUNE_CYCLE_S * 1000;
  const meet = Math.floor(ms / cycleMs);
  const t = (ms - meet * cycleMs) / 1000;
  const list: JuneAttempt[] = [];
  ORDER.forEach((slot, k) => {
    const sent = k * JUNE_STEP_S + JUNE_SENT_AT_S, lit = (k + 1) * JUNE_STEP_S;
    if (t < sent) return;
    const n = JUNE_NINE[k];
    const judged = t >= lit;
    list.push({
      id: `june-${meet}-${k}`, lift: slot.lift, number: slot.number, weight: n.weight,
      status: judged ? 'judged' : 'judging', call: judged ? callOf(n.lights) : null, lights: judged ? [...n.lights] : [],
    });
  });
  // the next moment something changes: an attempt sent, its lights, or the fresh meet
  const marks = ORDER.flatMap((_, k) => [k * JUNE_STEP_S + JUNE_SENT_AT_S, (k + 1) * JUNE_STEP_S]).concat(JUNE_CYCLE_S);
  const next = marks.find(m => m > t) ?? JUNE_CYCLE_S;
  return { meet, list, nextAt: meet * cycleMs + next * 1000 };
}

/** A June attempt id, as the cheer route accepts it. */
export const isJuneAttemptId = (id: unknown): id is string => typeof id === 'string' && /^june-\d{1,12}-[0-8]$/.test(id);
