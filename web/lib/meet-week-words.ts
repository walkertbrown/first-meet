// Meet week's rules and words that the page's own components use too (plan 5.23): the eight
// hours in Eastern, their labels in her time zone, the cutoff, the tie rule, the checklist's
// lines. No database here, so client components can import it; web/lib/meet-week re-exports it.
import type { Lift } from '@/db/schema';
import { barWeight, type Units } from '@/lib/meet';
import { homeWeightsLine, barLoading, liftLower } from '@/lib/stage/meet-words';

// ---------- the eight hours ----------

/** 5.23's eight slots, in Eastern wall time: day 0 is the Friday the window opens, day 1 the Saturday. Each is an hour. */
export const MEET_WEEK_SLOTS = [
  { day: 0, hour: 7 }, { day: 0, hour: 12 }, { day: 0, hour: 18 }, { day: 0, hour: 20 },
  { day: 1, hour: 8 }, { day: 1, hour: 9 }, { day: 1, hour: 11 }, { day: 1, hour: 14 },
] as const;
export const SLOT_COUNT = MEET_WEEK_SLOTS.length;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const ET = 'America/New_York';
const etParts = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
};

/** An Eastern wall time ("2027-02-26", 7) as an instant, in winter (−5) or summer (−4) time. */
export function etWallToUtc(day: string, hour: number): Date {
  for (const off of [5, 4]) {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCHours(hour + off);
    const p = etParts(d);
    if (p.day === day && p.hour === hour && p.minute === 0) return d;
  }
  // a wall hour the clocks skip: the hour after it
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCHours(hour + 4);
  return d;
}

/** The Eastern date of the Friday the window opens. */
export const meetFriday = (opensAt: Date) => etParts(opensAt).day;

const addDays = (day: string, n: number) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

/** When a slot starts, for a meet that opens at `opensAt`. */
export const slotStart = (opensAt: Date, slot: number) =>
  etWallToUtc(addDays(meetFriday(opensAt), MEET_WEEK_SLOTS[slot].day), MEET_WEEK_SLOTS[slot].hour);

/** The slot a saved flight hour is, or null. */
export const slotOf = (opensAt: Date, hour: Date | null) =>
  hour ? MEET_WEEK_SLOTS.findIndex((_, i) => slotStart(opensAt, i).getTime() === hour.getTime()) : -1;

/** 3.2: a real meet's hour is set 72 hours before the window opens (Tuesday 6 am Eastern for a 6 am Friday). */
export const hourSetAt = (m: { opensAt: Date; flightHourCutoffAt?: Date | null }) =>
  m.flightHourCutoffAt ?? new Date(m.opensAt.getTime() - 72 * HOUR_MS);

/** The Monday of week 12: her block's first Monday plus 11 weeks. */
export const weekTwelveMonday = (blockStart: string) => addDays(blockStart, 77);

/** Meet week is from the Monday of week 12 (Eastern) until the window opens. */
export const inMeetWeek = (blockStart: string | null, opensAt: Date | null, now: Date) =>
  !!blockStart && !!opensAt && etParts(now).day >= weekTwelveMonday(blockStart) && now < opensAt;

/**
 * The hour most of her flight picked, or null when nobody ticked any (5.23). A tie goes to the
 * earliest slot (the team's pick on the meet-week questions).
 */
export function flightWinner(counts: number[]): number | null {
  let best = -1;
  counts.forEach((n, i) => { if (n > 0 && (best < 0 || n > counts[best])) best = i; });
  return best < 0 ? null : best;
}

/** Before the cutoff, "4 in your flight ticked this" (look 5.9; nothing when nobody has). After it, "1 of your flight picked this" (5.23). */
export const tickedLine = (n: number) => (n > 0 ? `${n} in your flight ticked this` : '');
export const pickedLine = (n: number) => `${n} of your flight picked this`;

// ---------- the slot's words, in her time zone ----------

const clock = (h: number, m: number) => `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
const half = (h: number) => (h < 12 ? 'am' : 'pm');

/** "Sat 9–10 am", "Sat 11 am–12 pm" in a time zone. */
export function hourRange(start: Date, tz: string): string {
  const f = (d: Date) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' })
      .formatToParts(d).map(x => [x.type, x.value]));
    return { wd: p.weekday, h: Number(p.hour) % 24, m: Number(p.minute) };
  };
  const a = f(start), b = f(new Date(start.getTime() + HOUR_MS));
  if (a.wd !== b.wd) return `${a.wd} ${clock(a.h, a.m)} ${half(a.h)}–${b.wd} ${clock(b.h, b.m)} ${half(b.h)}`;
  return half(a.h) === half(b.h)
    ? `${a.wd} ${clock(a.h, a.m)}–${clock(b.h, b.m)} ${half(b.h)}`
    : `${a.wd} ${clock(a.h, a.m)} ${half(a.h)}–${clock(b.h, b.m)} ${half(b.h)}`;
}

/**
 * 5.23: "Sat 9–10 am ET" when the phone is in Eastern; elsewhere her own time with Eastern in
 * brackets, "Fri 4–5 am (7–8 am ET)", naming Eastern's day only when it isn't hers.
 */
export function slotLabel(start: Date, tz: string): string {
  const et = hourRange(start, ET), mine = hourRange(start, tz);
  if (mine === et) return `${et} ET`;
  // "Fri 11 pm–Sat 12 am" names its second day, so it keeps both
  const oneDay = !/–[A-Z][a-z]{2} /.test(et);
  return `${mine} (${oneDay && et.slice(0, 3) === mine.slice(0, 3) ? et.slice(4) : et} ET)`;
}

// ---------- the checklist's lines ----------

/**
 * Barbell (5.23): "Your bar and plates for your openers: squat 100 lb, 45 lb bar + a green 25 and
 * a 2½ on each side; bench press 65 lb, …", one per lift in meet order.
 */
export function barbellChecklistLine(picks: { lift: Lift; weight: number }[], units: Units, bar = barWeight(units)) {
  return `Your bar and plates for your openers: ${picks.map(p => `${liftLower(p.lift, 'barbell')} ${p.weight} ${units}, ${barLoading(p.weight, units, bar)}`).join('; ')}`;
}

/** Home (5.23): "Your weights for your openers: One 25 lb dumbbell, two 15 lb dumbbells", each once, as she owns them. */
export function homeChecklistLine(picks: { lift: Lift; weight: number; kind?: 'pair' | 'bell' }[], units: Units) {
  const lines = [...new Set(picks.map(p => homeWeightsLine(p.weight, units, p.lift, p.kind)))]
    .map((x, i) => (i ? x[0].toLowerCase() + x.slice(1) : x));
  return `Your weights for your openers: ${lines.join(', ')}`;
}
