// The demo flight (plan 5.36): six made-up flightmates whose attempts land every 20–40 s while
// she's on the platform, so flight time and cheers can be seen. Their lights are replayed from
// the stored results below; nothing is written and no Workflow runs. Like June (web/lib/june.ts),
// the clock alone says where they are, so every demo lifter sees the same flight.
import type { Lift } from '@/db/schema';
import { ORDER } from '@/lib/meet';
import { liftWord } from '@/lib/stage/meet-words';

type Light = 'white' | 'red';
type Division = 'barbell' | 'home';

/** First names only, as the strip shows them. W = a white light, R = a red one, three per attempt. */
const MATES: { name: string; barbell: [number, number, number]; home: [number, number, number]; lights: string }[] = [
  { name: 'Priya', barbell: [115, 75, 155], home: [25, 15, 30], lights: 'WWW WWW WRW  WWW WWR RRW  WWW WWW WWW' },
  { name: 'Maren', barbell: [135, 85, 185], home: [30, 20, 35], lights: 'WWW RWW WWW  WWW WWW RRR  WWW WRW RWR' },
  { name: 'Tess', barbell: [95, 65, 135], home: [20, 12, 25], lights: 'WWW WWW WWW  WRW WWW WWW  WWW WWW RRW' },
  { name: 'Lucia', barbell: [125, 70, 165], home: [25, 15, 35], lights: 'RWR WWW WWW  WWW WWW WRR  WWW WWW WWW' },
  { name: 'Ada', barbell: [105, 60, 145], home: [20, 10, 30], lights: 'WWW WWW RRR  WWW WWW WWW  WWW RWW WWW' },
  { name: 'Rhea', barbell: [145, 90, 205], home: [35, 20, 40], lights: 'WWW WWW WWR  WWW RRW WWW  WWW WWW WRW' },
];
export const DEMO_FLIGHT_NAMES = MATES.map(m => m.name);

/** Barbell: +10 lb then +10 (squat, deadlift) or +5 then +5 (bench). Home: the same bell, 8 → 10 → 12 reps. */
const STEP: Record<Lift, number> = { squat: 10, bench: 5, deadlift: 10 };
const lbToKg = (lb: number) => Math.round(lb / 2.20462 / 2.5) * 2.5;

/** One arrival a round: each round, the six lift their next attempt, in a turning order. */
const ARRIVALS = ORDER.flatMap((slot, k) => MATES.map((_, j) => ({ k, mate: (j + k) % MATES.length, slot })));
/** 20–40 s between arrivals, the same every loop. */
const GAPS = ARRIVALS.map((_, i) => 20 + ((i * 7919 + 13) % 21));
const OFFSETS = GAPS.reduce<number[]>((acc, g, i) => [...acc, (acc[i - 1] ?? 0) + g], []);
export const DEMO_FLIGHT_CYCLE_S = OFFSETS[OFFSETS.length - 1];

export type FlightRow = { id: string; name: string; lift: Lift; number: number; what: string; lights: Light[] };

function rowOf(cycle: number, i: number, division: Division, units: 'lb' | 'kg'): FlightRow {
  const { k, mate, slot } = ARRIVALS[i];
  const m = MATES[mate];
  const li = ['squat', 'bench', 'deadlift'].indexOf(slot.lift);
  const lights = m.lights.replace(/ /g, '').slice(k * 3, k * 3 + 3).split('').map(c => (c === 'W' ? 'white' : 'red')) as Light[];
  const w = (lb: number) => (units === 'kg' ? lbToKg(lb) : lb);
  const what = division === 'home'
    ? `${w(m.home[li])} × ${8 + (slot.number - 1) * 2}`
    : `${w(m.barbell[li] + STEP[slot.lift] * (slot.number - 1))}`;
  return { id: `flight-${cycle}-${i}`, name: m.name, lift: slot.lift, number: slot.number, what: `${liftWord(slot.lift, division)} ${slot.number} · ${what}`, lights };
}

/** The flight at `now`: its latest `n` attempts, newest first, and when the next one lands (epoch ms). */
export function demoFlightAt(now: Date, division: Division, units: 'lb' | 'kg', n = 3) {
  const cycleMs = DEMO_FLIGHT_CYCLE_S * 1000;
  const ms = now.getTime();
  const cycle = Math.floor(ms / cycleMs);
  const t = (ms - cycle * cycleMs) / 1000;
  let last = OFFSETS.findIndex(o => o > t) - 1; // the newest that has landed
  if (last < -1) last = OFFSETS.length - 1;
  const rows: FlightRow[] = [];
  for (let back = 0; rows.length < n; back++) {
    const i = last - back;
    rows.push(i >= 0 ? rowOf(cycle, i, division, units) : rowOf(cycle - 1, ARRIVALS.length + i, division, units));
  }
  const next = OFFSETS.find(o => o > t) ?? DEMO_FLIGHT_CYCLE_S;
  return { rows, nextAt: cycle * cycleMs + next * 1000 };
}

/** A demo flightmate's attempt id, as the cheer route takes it. */
export const isDemoFlightId = (id: unknown): id is string => typeof id === 'string' && /^flight-\d{1,12}-\d{1,2}$/.test(id);
