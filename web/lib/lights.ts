// The referee's three lamps (plan 5.33): what "Save the lights" still needs, and the one reason
// the attempt carries when each red light has its own. Kept free of server code so the referee's
// page and the save route share it.

export type Light = 'white' | 'red';

/** Two whites is a good lift (5.25). */
export const callOf = (lights: Light[]) => (lights.filter(l => l === 'white').length >= 2 ? 'white' : 'red');

/** The lamps that are red, by index (0 Left, 1 Head, 2 Right). */
export const redLamps = (lights: (Light | null)[]) => lights.flatMap((l, i) => (l === 'red' ? [i] : []));

/**
 * Plan 5.33's line above "Save the lights": the first thing missing, or null once nothing is.
 * Every lamp set, then every red with a reason, then (Home) the rep that got the red light.
 */
export function saveLine(lights: (Light | null)[], reasons: (string | null)[], home: boolean, rep: number | null): string | null {
  if (lights.length !== 3 || !lights.every(Boolean)) return 'Set all three lights to save.';
  const reds = redLamps(lights);
  if (reds.some(i => !reasons[i])) return reds.length === 1 ? 'Pick a reason for the red light.' : 'Pick a reason for each red light.';
  if (home && reds.length > 0 && rep === null) return 'Tap the rep that got the red light.';
  return null;
}

/**
 * A red attempt shows the lifter one reason: the one most red lights gave. On a tie, the head
 * referee's (the middle lamp) if it's red, otherwise the first red lamp from the left.
 */
export function attemptReason(lights: Light[], reasons: (string | null)[]): string | null {
  const reds = redLamps(lights).filter(i => reasons[i]);
  if (!reds.length) return null;
  const count = new Map<string, number>();
  for (const i of reds) count.set(reasons[i]!, (count.get(reasons[i]!) ?? 0) + 1);
  const top = Math.max(...count.values());
  const order = reds.includes(1) ? [1, ...reds.filter(i => i !== 1)] : reds;
  return reasons[order.find(i => count.get(reasons[i]!) === top)!]!;
}
