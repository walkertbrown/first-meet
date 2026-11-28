// The sample meet (plan 5.3): 40 made-up lifters in content/sample-meet.json, and the 90-second
// scripted replay over them. Everything here is a pure function of the replay's clock, so any
// moment (and every chapter) can be jumped to.
import data from '../../content/sample-meet.json';
import type { Lift } from '@/db/schema';
import { ORDER, meetTotal, type MeetAttempt } from '@/lib/meet';
import { boardRows, type BoardLifter, type Division } from '@/lib/board';
import { cardView, type CardView } from '@/lib/card/card-view';

type Raw = { lift: string; n: number; weight: number; reps?: number; call: string; reason?: string; lights?: string[]; close?: boolean };
type RawLifter = { name: string; sayIt: string; age: number; ageGroup: string; division: string; hometown: string; line: string; attempts: Raw[] };

export type SampleLifter = BoardLifter & { sayIt: string; line: string; hometown: string };
export type SampleLight = { id: string; name: string; division: Division; lift: Lift; number: number; weight: number; reps: number | null; call: 'white' | 'red'; reason: string | null; close: boolean; lights: ('white' | 'red')[] };

export const SAMPLE_MEET_NAME = data.name;

// Saturday morning, the order the lights landed in: lifter by lifter, slot by slot, a minute apart.
const SATURDAY = Date.UTC(2027, 1, 27, 14, 0);

export const SAMPLE_LIFTERS: SampleLifter[] = (data.lifters as RawLifter[]).map((l, i) => ({
  id: `sample-${i + 1}`, name: l.name, sayIt: l.sayIt, ageGroup: l.ageGroup, age: l.age, division: l.division as Division,
  units: 'lb', hometown: l.hometown, line: l.line,
  attempts: l.attempts.map((a): MeetAttempt => ({
    lift: a.lift as Lift, number: a.n, weight: a.weight, repsDeclared: a.reps ?? null, status: 'judged',
    call: a.call as 'white' | 'red', recordedAt: new Date(SATURDAY + (ORDER.findIndex(o => o.lift === a.lift && o.number === a.n) * 40 + i) * 60_000),
  })),
}));

/** Every light in the meet, in the order it landed. */
export const SAMPLE_LIGHTS: SampleLight[] = (data.lifters as RawLifter[])
  .flatMap((l, i) => l.attempts.map(a => ({ l, i, a, at: SAMPLE_LIFTERS[i].attempts.find(x => x.lift === a.lift && x.number === a.n)!.recordedAt!.getTime() })))
  .sort((x, y) => x.at - y.at)
  .map(({ l, i, a }) => ({
    id: `sample-${i + 1}-${a.lift}-${a.n}`, name: l.name, division: l.division as Division, lift: a.lift as Lift, number: a.n,
    weight: a.weight, reps: a.reps ?? null, call: a.call as 'white' | 'red', reason: a.reason ?? null, close: !!a.close,
    lights: (a.lights ?? [a.call, a.call, a.call]) as ('white' | 'red')[],
  }));

export const sampleLifter = (name: string) => SAMPLE_LIFTERS.find(l => l.name === name)!;

/** Dana W.'s meet card (chapter 5), drawn by /api/card/sample.png. */
export function sampleCardView(): CardView | null {
  const l = sampleLifter('Dana W.');
  const t = meetTotal(l.attempts, l.division);
  if (t.kind !== 'total') return null;
  return cardView({ cardName: l.name, ageGroup: l.ageGroup, division: l.division, hometown: l.hometown, units: l.units }, SAMPLE_MEET_NAME, t);
}
export const SAMPLE_CARD = '/api/card/sample.png?f=story';

// ---------- the replay ----------

export const REPLAY_S = 90;
export const CHAPTERS = [
  { at: 0, label: 'Friday 6 am · the platform opens' },
  { at: 10, label: 'Saturday morning · lights land' },
  { at: 36, label: 'A close call' },
  { at: 50, label: '8 pm · meet night' },
  { at: 76, label: 'Her card' },
] as const;

export const chapterAt = (t: number) => CHAPTERS.reduce((c, ch, i) => (t >= ch.at ? i : c), 0);

/** Chapter 2's three attempts with drawn figures: a good squat, a good bench, and a red squat for depth. */
const featured = (() => {
  const pickBy = (f: (x: SampleLight) => boolean) => SAMPLE_LIGHTS.find(f)!;
  const good = pickBy(x => x.division === 'barbell' && x.lift === 'squat' && x.call === 'white' && !x.close && x.number === 2);
  const bench = pickBy(x => x.division === 'barbell' && x.lift === 'bench' && x.call === 'white' && !x.close && x.name !== good.name);
  const red = pickBy(x => x.division === 'barbell' && x.lift === 'squat' && x.call === 'red' && x.reason === 'depth' && x.name !== good.name);
  return [good, bench, red];
})();
export const FEATURED = featured;
/** When each featured attempt's lamps start lighting (three lamps, 330 ms apart, as everywhere). */
export const FEATURED_AT = [14, 21, 28];
/** Chapter 3's close call: the bot looks, and 6 s later in the replay its lights land. */
export const CLOSE_CALL = SAMPLE_LIGHTS.find(x => x.close && x.division === 'barbell')!;
export const CLOSE_AT = 38, CLOSE_LANDS_AT = CLOSE_AT + 6;

/** How far through the meet's lights the replay is (chapter 2 fills the ticker, and the board fills to every total by chapter 4). */
export function lightsLanded(t: number): number {
  const n = SAMPLE_LIGHTS.length;
  if (t < CHAPTERS[1].at) return 0;
  if (t >= CHAPTERS[3].at) return n;
  return Math.round(((t - CHAPTERS[1].at) / (CHAPTERS[3].at - CHAPTERS[1].at)) * n);
}

/** The lifters as the replay has them at t: only the lights landed so far. */
export function liftersAt(t: number): BoardLifter[] {
  const landed = new Set(SAMPLE_LIGHTS.slice(0, lightsLanded(t)).map(x => x.id));
  return SAMPLE_LIFTERS.map((l, i) => ({ ...l, attempts: l.attempts.filter(a => landed.has(`sample-${i + 1}-${a.lift}-${a.number}`)) }));
}

/** The ticker's last 8 lights at t, newest first. */
export const tickerAt = (t: number) => SAMPLE_LIGHTS.slice(0, lightsLanded(t)).slice(-8).reverse();

/** First totals so far (the count), Barbell and Home together. */
export const totalsAt = (t: number) => {
  const ls = liftersAt(t);
  return boardRows(ls, 'barbell', false).length + boardRows(ls, 'home', false).length;
};

/** The roll call (5.35): everyone who totaled, in age-group order, oldest group first. */
export function rollCall(list: BoardLifter[]) {
  const order = ['70+', '60–69', '50–59', '40–49', 'Open'];
  const rows = [...boardRows(list, 'barbell'), ...boardRows(list, 'home')];
  return order.flatMap(g => rows.filter(r => r.ageGroup === g)).map(r => ({ id: r.id, name: r.name, ageGroup: r.ageGroup, total: `${r.totalText} ${r.units}` }));
}
