// A lifter's corner page on the server (plan 5.4): public, by her corner token, with no account.
// Before meet weekend, during it (her nine, live), after she totals, after she bombs out, and
// once her account is gone. June Okafor's page (/corner/demo, 5.36) is the same page, read from
// the clock (web/lib/june.ts). The rules are web/lib/meet.ts; this only puts them together.
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { lifters, meets, type Lift } from '@/db/schema';
import { meetTotal, type MeetAttempt, type Units } from '@/lib/meet';
import { asMeetAttempt, meetAttempts, platformOpen, type AttemptRow, type LifterRow } from '@/lib/meet-flow';
import { nineRow, type RowCell } from '@/lib/platform-view';
import { formatTotal } from '@/lib/total-view';
import { juneAt, JUNE } from '@/lib/june';
import { liftWord } from '@/lib/stage/meet-words';
import { keepWhole } from '@/lib/site';

type Division = 'barbell' | 'home';
type Light = 'white' | 'red';

/** One of her attempts in the list (newest first). */
export type CornerRow = {
  id: string; lift: Lift; number: number;
  /** "Squat 2 · 135 lb", or on Home "Goblet squat 2 · 10 reps at 25 lb" */
  name: string; weight: string;
  /** looking: sending or with the judges; close: a referee is looking; white/red: its lights */
  state: 'looking' | 'close' | 'white' | 'red';
  lights: Light[];
  /** her clip (9:16), when her clip_visibility lets anyone with the link see it */
  clip: string | null;
};

type Shared = { meetName: string; name: string; division: Division; demo: boolean; june: boolean; row: RowCell[]; list: CornerRow[]; nextAt: number | null };
export type CornerView =
  | { kind: 'gone' }
  | { kind: 'before'; meetName: string; name: string; title: string }
  | (Shared & { kind: 'live'; notStarted: string | null })
  | (Shared & { kind: 'totaled'; total: string; unit: Units })
  | (Shared & { kind: 'bombed' });

const SENT = ['uploading', 'queued', 'judging', 'close_call', 'judged'];
const DAY = 86_400_000;
const et = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleString('en-US', { ...o, timeZone: 'America/New_York' });

/** "Feb 26–27", or "Feb 28 – Mar 1" across a month. */
export function weekendWords(opens: Date, closes: Date | null): string {
  const a = et(opens, { month: 'short', day: 'numeric' });
  if (!closes) return keepWhole(a);
  const [am, ad] = a.split(' ');
  const b = et(closes, { month: 'short', day: 'numeric' });
  const [bm, bd] = b.split(' ');
  if (b === a) return keepWhole(a);
  return keepWhole(am === bm ? `${am} ${ad}–${bd}` : `${a} – ${b}`);
}

/** Before meet weekend: "… lifts this weekend.", or "… lifts on Feb 26–27." more than 7 days out. */
export function beforeTitle(name: string, opens: Date, closes: Date | null, now: Date): string {
  return opens.getTime() - now.getTime() > 7 * DAY ? `${name} lifts on ${weekendWords(opens, closes)}.` : `${name} lifts this weekend.`;
}

/** "Saturday 6 pm" (Eastern), from the platform's close. */
const closesWords = (d: Date) => et(d, { weekday: 'long', hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' AM', ' am').replace(' PM', ' pm');

/** Before her first attempt (5.4). The demo meet never closes, so its line has no closing time. */
export function notStartedLine(closes: Date | null): string {
  return closes
    ? `She hasn't started yet. The platform is open until ${keepWhole(`${closesWords(closes)} Eastern`)}. Keep this page open and her lifts appear as they land.`
    : 'She hasn\'t started yet. Keep this page open and her lifts appear as they land.';
}

export const weightWords = (a: { weight: number; repsDeclared: number | null }, division: Division, units: string) =>
  keepWhole(division === 'home' ? `${a.repsDeclared ?? 0} reps at ${a.weight} ${units}` : `${a.weight} ${units}`);

function rowOf(a: Pick<AttemptRow, 'id' | 'lift' | 'number' | 'weight' | 'repsDeclared' | 'status' | 'call' | 'lights'>, division: Division, units: string, clip: string | null): CornerRow {
  const lights = ((a.lights ?? []) as string[]).filter((x): x is Light => x === 'white' || x === 'red');
  const state: CornerRow['state'] = a.call === 'white' || a.call === 'red' ? a.call : a.call === 'close' || a.status === 'close_call' ? 'close' : 'looking';
  return {
    id: a.id, lift: a.lift as Lift, number: a.number, name: `${liftWord(a.lift as Lift, division)} ${a.number}`,
    weight: weightWords(a, division, units), state, lights: state === 'white' || state === 'red' ? lights : [], clip,
  };
}

const newestFirst = <T extends { lift: string; number: number }>(rows: T[]) => {
  const order = ['squat', 'bench', 'deadlift'];
  return [...rows].sort((x, y) => (order.indexOf(y.lift) * 3 + y.number) - (order.indexOf(x.lift) * 3 + x.number));
};

/** The page for a lifter's corner token, or June's for "demo". `clipUrl` signs a clip's link. */
export async function cornerView(db: Db, token: string, now = new Date(), clipUrl: (key: string) => Promise<string | null> = async () => null): Promise<CornerView | null> {
  if (token === 'demo') return juneView(now);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return null;
  const [l] = await db.select().from(lifters).where(eq(lifters.cornerToken, token));
  if (!l) return null;
  if (l.deletedAt) return { kind: 'gone' };
  if (!l.meetId) return null;
  const [m] = await db.select().from(meets).where(eq(meets.id, l.meetId));
  if (!m) return null;
  return lifterView(db, l, m, now, clipUrl);
}

async function lifterView(db: Db, l: LifterRow, m: typeof meets.$inferSelect, now: Date, clipUrl: (key: string) => Promise<string | null>): Promise<CornerView> {
  const name = l.cardName;
  const demo = m.kind === 'demo';
  if (!demo && m.opensAt && now < m.opensAt) return { kind: 'before', meetName: m.name, name, title: beforeTitle(name, m.opensAt, m.closesAt, now) };
  const rows = await meetAttempts(db, l);
  const division = l.division as Division;
  const units = l.units as Units;
  const sent = newestFirst(rows.filter(a => SENT.includes(a.status)));
  const canShowClip = l.clipVisibility === 'link';
  const list = await Promise.all(sent.map(async a => rowOf(a, division, units, canShowClip && a.clipKey ? await clipUrl(a.clipKey) : null)));
  const shared: Shared = { meetName: m.name, name, division, demo, june: false, row: nineRow(rows, null), list, nextAt: null };
  const t = meetTotal(rows.map(a => asMeetAttempt(a, l)), division);
  if (t.kind === 'total') return { ...shared, kind: 'totaled', total: formatTotal(t.value), unit: units };
  if (t.kind === 'bombed') return { ...shared, kind: 'bombed' };
  return { ...shared, kind: 'live', notStarted: list.length ? null : platformOpen(m, now) || demo ? notStartedLine(demo ? null : m.closesAt) : null };
}

/** /corner/demo: June's meet, where the clock has it (5.36). */
export function juneView(now = new Date()): CornerView {
  const { list: js, nextAt } = juneAt(now);
  const division = JUNE.division, units = JUNE.units;
  const rows = js.map(a => ({ ...a, repsDeclared: null }));
  const list = newestFirst(rows).map(a => rowOf(a, division, units, null));
  const shared: Shared = {
    meetName: 'Demo meet', name: JUNE.cardName, division, demo: true, june: true,
    row: nineRow(rows, null), list, nextAt,
  };
  const t = meetTotal(rows.map((a): MeetAttempt => ({ ...a, recordedAt: null })), division);
  if (t.kind === 'total') return { ...shared, kind: 'totaled', total: formatTotal(t.value), unit: units };
  if (t.kind === 'bombed') return { ...shared, kind: 'bombed' };
  return { ...shared, kind: 'live', notStarted: list.length ? null : notStartedLine(null) };
}
