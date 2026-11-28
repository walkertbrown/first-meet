// Soo's host desk (plan 5.35), the parts that are only arithmetic: the read-out queues, the roll call's
// order and pace, and its two rows. Free of server code, so /host, /host/sample and the tests share it.
import { awards, boardRows, type BoardLifter, type BoardRow } from '@/lib/board';
import type { Readout, RollEntry } from '@/components/host-desk';

/** A lifter as the desk sees her: the board's, with how to say her name and her line. */
export type HostLifter = BoardLifter & { sayIt?: string | null; line?: string | null };

export const SMALL_MEET = 150;
/** Oldest group first (5.35). */
export const ROLL_ORDER = ['70+', '60–69', '50–59', '40–49', 'Open'];

export type Queue = { eyebrow: 'AWARDS' | 'AGE-GROUP LEADERS' | 'FIRST TOTALS'; items: Readout[] };

const divisionWord = (d: string) => (d === 'home' ? 'Home' : 'Barbell');

function allRows(list: HostLifter[]): BoardRow[] {
  return [...boardRows(list, 'barbell'), ...boardRows(list, 'home')];
}

const byAge = (rows: BoardRow[]) => ROLL_ORDER.flatMap(g => rows.filter(r => r.ageGroup === g));

function readoutOf(r: BoardRow, l: HostLifter | undefined, award?: string): Readout {
  return {
    id: r.id, name: r.name, sayIt: l?.sayIt || null, ageGroup: r.ageGroup, division: divisionWord(r.division),
    hometown: l?.hometown || null, total: r.totalText, units: r.units, line: l?.line || null, award: award ?? null,
  };
}

/**
 * The read-out queues, in order (5.35): AWARDS, AGE-GROUP LEADERS, FIRST TOTALS. Each lifter is in
 * one list, the first she belongs to, and once:
 * - AWARDS: every award but "Top total" (its winners are the leaders), her titles together;
 * - AGE-GROUP LEADERS: the top 3 of each age group in each division, oldest group first;
 * - FIRST TOTALS: everyone else, only at a small meet (150 totals or fewer).
 * `done` (read or skipped) are left out, so a reload picks up where she was.
 */
export function readoutQueues(list: HostLifter[], done: Set<string> = new Set()): Queue[] {
  const rows = allRows(list);
  const by = new Map(list.map(l => [l.id, l]));
  const row = new Map(rows.map(r => [r.id, r]));
  const placed = new Set<string>();
  const take = (id: string) => (placed.has(id) ? false : (placed.add(id), true));

  const titles = new Map<string, string[]>();
  for (const a of awards(list)) if (a.kind !== 'top_total') titles.set(a.lifterId, [...(titles.get(a.lifterId) ?? []), a.title]);
  const awardItems = byAge(rows).filter(r => titles.has(r.id) && take(r.id)).map(r => readoutOf(r, by.get(r.id), [...new Set(titles.get(r.id))].join(' · ')));

  const leaders: BoardRow[] = [];
  for (const g of ROLL_ORDER) for (const d of ['barbell', 'home'] as const) leaders.push(...rows.filter(r => r.division === d && r.ageGroup === g).slice(0, 3));
  const leaderItems = leaders.filter(r => take(r.id)).map(r => readoutOf(r, by.get(r.id)));

  const firstItems = rows.length <= SMALL_MEET ? byAge(rows).filter(r => take(r.id)).map(r => readoutOf(row.get(r.id)!, by.get(r.id))) : [];

  const keep = (items: Readout[]) => items.filter(i => !done.has(i.id));
  return ([
    { eyebrow: 'AWARDS', items: keep(awardItems) },
    { eyebrow: 'AGE-GROUP LEADERS', items: keep(leaderItems) },
    { eyebrow: 'FIRST TOTALS', items: keep(firstItems) },
  ] as Queue[]).filter(q => q.items.length);
}

/** These lifters' read-outs in the order given, those with a total only (/host/sample's demo lifters, newest first: 5.36). */
export function readoutsInOrder(list: HostLifter[]): Readout[] {
  const row = new Map(allRows(list).map(r => [r.id, r]));
  return list.filter(l => row.has(l.id)).map(l => readoutOf(row.get(l.id)!, l));
}

const rollEntry = (r: BoardRow): RollEntry => ({ id: r.id, name: r.name, ageGroup: r.ageGroup, total: `${r.totalText} ${r.units}` });

/** The roll call (5.35): everyone who totaled, oldest age group first, best first within it. */
export function rollEntries(list: HostLifter[]): RollEntry[] {
  return byAge(allRows(list)).map(rollEntry);
}

/** These lifters' roll call entries in the order given (/host/sample's demo lifters, newest first: 5.36). */
export function rollEntriesInOrder(list: HostLifter[]): RollEntry[] {
  const row = new Map(allRows(list).map(r => [r.id, r]));
  return list.filter(l => row.has(l.id)).map(l => rollEntry(row.get(l.id)!));
}

export type Pace = { rows: 1 | 2; perRow: number; rowPace: number; seconds: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * The roll call's pace (5.35): seconds per name = live seconds ÷ totals, between 1.5 s and 6 s. Over
 * 600 totals, or under 3 s a name, two rows with half the names each, so each name gets twice as long.
 * `seconds` is how long the whole roll call takes.
 */
export function rollPace(n: number, liveMinutes: number): Pace {
  const live = Math.max(1, liveMinutes) * 60;
  if (n <= 0) return { rows: 1, perRow: 0, rowPace: 0, seconds: 0 };
  const rows = n > 600 || live / n < 3 ? 2 : 1;
  const perRow = Math.ceil(n / rows);
  const rowPace = clamp(live / perRow, 1.5, 6);
  return { rows, perRow, rowPace, seconds: perRow * rowPace };
}

/** The names on each row: alternating, so both rows run oldest group first. */
export function splitRows<T>(entries: T[], rows: 1 | 2): T[][] {
  if (rows === 1) return [entries];
  return [entries.filter((_, i) => i % 2 === 0), entries.filter((_, i) => i % 2 === 1)];
}

/** With reduced motion (5.35 piece 12), a page of names per row that swaps every 18 s. */
export const PAGE_S = 18;
export const namesPerPage = (rowPace: number) => Math.max(1, Math.round(PAGE_S / Math.max(rowPace, 1.5)));

/** The Small line under the controls: "Roll call: <done> of <n> · ends about <time>". */
export function rollLine(done: number, n: number, endsAt: Date | null, zone = 'America/New_York') {
  const time = endsAt ? endsAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone }).toLowerCase() : null;
  return `Roll call: ${done.toLocaleString('en-US')} of ${n.toLocaleString('en-US')}${time && done < n ? ` · ends about ${time}` : ''}`;
}

/** The Caption under the card: "<n> left in this list". */
export const leftLine = (n: number) => `${n} left in this list`;
/** The small meet's Caption (5.35). */
export const smallMeetLine = (n: number) => `${n} totals tonight: you could read every name.`;
