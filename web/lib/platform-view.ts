// The platform page on the server (plan 5.24–5.28): where she is in the nine, the window's state,
// the card for the attempt she lifts now, and the 9-attempt row. The rules are web/lib/meet.ts and
// web/lib/meet-flow.ts; this only puts them together for the page.
import type { Db } from '@/db';
import type { Lift, VoidReason } from '@/db/schema';
import { ORDER, homeKind, platformState, type Units } from '@/lib/meet';
import { declareNext, lifterCaps, meetAttempts, platformOpen, type AttemptRow, type LiftCap, type LifterRow } from '@/lib/meet-flow';
import { demoBecause } from '@/lib/demo';
import { capSentence } from '@/lib/stage/meet-words';
import { meetClosed, runClipDeadline } from '@/lib/meet-window';

/** One cell of the 9-attempt row (look 4, plan 5.27). */
export type RowCell = {
  lift: Lift; number: number;
  /** declared: on her card; now: the one she lifts or looks at; lit: judged; waiting: a close call;
   * void: not judged for good (3.8, item 85: started after the close, or sent too late) */
  state: 'empty' | 'declared' | 'now' | 'sent' | 'waiting' | 'white' | 'red' | 'void';
  /** a `void` slot's reason, for its screen reader label */
  voidReason?: VoidReason | null;
};

export type CardAttempt = {
  id: string; lift: string; number: number; weight: number; reps_declared: number | null; status: string;
  kind: 'pair' | 'bell' | null;
};

/** One of her nine after the meet, as "See my lifts" lists it. */
export type DoneAttempt = {
  id: string; lift: Lift; number: number; weight: number; reps: number | null; call: 'white' | 'red' | 'close' | null; lights: ('white' | 'red')[];
  /** after the close (item 85): not judged, and why; or still on its way (sending, or with the judges) */
  voidReason?: VoidReason | null; held?: boolean;
};

export type PlatformView =
  | { kind: 'before'; opensAt: string; closesAt: string | null; meetName: string }
  | { kind: 'closed'; meetName: string }
  | { kind: 'done'; meetName: string; row: RowCell[]; nine: DoneAttempt[] }
  | {
    kind: 'open'; meetName: string; demo: boolean; closesAt: string | null;
    row: RowCell[];
    current: CardAttempt;
    because: string; notJudged: boolean;
  };

const PAST: Record<Lift, string> = { squat: 'squatted', bench: 'benched', deadlift: 'deadlifted' };
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

/**
 * The card's because line (5.25 step 1). Judged, Barbell: "You squatted <cap> for 3 with white
 * lights on <date>. This one is lighter, so it's already yours." Judged, Home: "You did <cap reps>
 * at <w> with white lights on <date>. This one is fewer, so it's already yours." Not judged: "Lighter
 * than your best logged triple. Not judged in training yet." (Home: "Fewer than your best logged
 * set. …")
 *
 * At exactly her cap (`declared`: the weight on Barbell, the reps on Home), "lighter" and
 * "fewer" aren't true, so the second sentence says "the same".
 */
export function becauseLine(division: 'barbell' | 'home', lift: Lift, cap: LiftCap, units: Units, declared?: number | null): string {
  const same = declared != null && declared === cap.cap;
  if (!cap.judged || !cap.at) {
    if (same) return division === 'home' ? 'The same as your best logged set. Not judged in training yet.' : 'The same weight as your best logged triple, for just one. Not judged in training yet.';
    return division === 'home' ? 'Fewer than your best logged set. Not judged in training yet.' : 'Lighter than your best logged triple. Not judged in training yet.';
  }
  const date = shortDate(cap.at);
  if (division === 'home') return `You did ${cap.cap} at ${cap.weight} ${units} with white lights on ${date}. ${capSentence('home', same)}`;
  return `You ${PAST[lift]} ${cap.cap} for 3 with white lights on ${date}. ${capSentence('barbell', same)}`;
}

/** A void that stays (3.8, item 85): started after the close, or sent too late. */
export const notJudgedVoid = (a: Pick<AttemptRow, 'status'> & { voidReason?: VoidReason | null }) =>
  a.status === 'void' && (a.voidReason === 'after_close' || a.voidReason === 'upload_late');

/**
 * The 9-attempt row: every slot, in the meet's order. After the close (`closed`), a slot only
 * declared keeps a never-lifted slot's empty look (3.8: a lift she didn't take isn't "not judged").
 */
export function nineRow(rows: (Pick<AttemptRow, 'lift' | 'number' | 'status' | 'call'> & { voidReason?: VoidReason | null })[], current: { lift: string; number: number } | null, closed = false): RowCell[] {
  return ORDER.map(slot => {
    const a = rows.find(r => r.lift === slot.lift && r.number === slot.number);
    const now = !!current && current.lift === slot.lift && current.number === slot.number;
    let state: RowCell['state'] = 'empty';
    if (a) {
      if (a.call === 'white' || a.call === 'red') state = a.call;
      else if (a.call === 'close' || a.status === 'close_call') state = 'waiting';
      else if (notJudgedVoid(a)) return { lift: slot.lift, number: slot.number, state: 'void', voidReason: a.voidReason ?? null };
      else if (closed && a.status === 'declared') state = 'empty';
      else if (now) state = 'now';
      else state = a.status === 'declared' ? 'declared' : 'sent';
    }
    return { lift: slot.lift, number: slot.number, state };
  });
}

const HELD = ['recording', 'uploading', 'queued', 'judging'];

/** One attempt as "See my lifts" lists it. */
const doneAttempt = (a: AttemptRow): DoneAttempt => ({
  id: a.id, lift: a.lift, number: a.number, weight: a.weight, reps: a.repsDeclared,
  call: (a.call ?? null) as DoneAttempt['call'],
  lights: ((a.lights ?? []) as string[]).filter((x): x is 'white' | 'red' => x === 'white' || x === 'red'),
  voidReason: notJudgedVoid(a) ? a.voidReason : null,
  held: HELD.includes(a.status),
});

/**
 * What /platform shows her now (5.24). With nothing on her card yet and the window open, her next
 * opener is declared for her (5.25 step 11: "Next: <lift>" has no sheet). After all nine have
 * lights or a close call, it's the total (5.28).
 */
export async function platformView(db: Db, l: LifterRow, meet: { id?: string; kind: string; status: string; name: string; opensAt: Date | null; closesAt: Date | null; clipDeadlineAt?: Date | null }, now = new Date()): Promise<PlatformView> {
  const meetName = meet.name;
  let rows = await meetAttempts(db, l);
  if (meet.kind !== 'demo' && meet.opensAt && now < meet.opensAt) return { kind: 'before', opensAt: meet.opensAt.toISOString(), closesAt: meet.closesAt?.toISOString() ?? null, meetName };
  const open = platformOpen(meet as Parameters<typeof platformOpen>[0], now);
  let st = platformState(rows);
  if (!open) {
    const times = { kind: meet.kind as 'real', closesAt: meet.closesAt, clipDeadlineAt: meet.clipDeadlineAt ?? null };
    if (meet.id && meetClosed(times, now)) {
      // after the close (3.8, item 85): the clip deadline settles clips that never arrived, then her
      // total doesn't wait for all nine. Uploads left pending keep sending from this page.
      if (await runClipDeadline(db, now, meet.id)) rows = await meetAttempts(db, l);
      const judged = rows.some(a => a.call === 'white' || a.call === 'red' || a.call === 'close' || ['judged', 'close_call'].includes(a.status));
      const held = rows.some(a => HELD.includes(a.status));
      // nothing judged and nothing on its way: she didn't lift this time (a lift refused at the close included)
      if (!judged && !held) return { kind: 'closed', meetName };
      const nine = ORDER.map(s => rows.find(a => a.lift === s.lift && a.number === s.number))
        .filter((a): a is AttemptRow => !!a && a.status !== 'declared').map(doneAttempt);
      return { kind: 'done', meetName, row: nineRow(rows, null, true), nine };
    }
    // uploads left pending at close keep uploading (3.8); with none lifted, the closed page
    const lifted = rows.some(a => a.status !== 'declared');
    if (!lifted) return { kind: 'closed', meetName };
  }
  if (st.done && st.current && ['judged', 'close_call'].includes(st.current.status)) {
    const nine = ORDER.map(s => rows.find(a => a.lift === s.lift && a.number === s.number)!).map(doneAttempt);
    return { kind: 'done', meetName, row: nineRow(rows, null), nine };
  }
  if (open && !st.current && st.toDeclare?.number === 1) {
    await declareNext(db, l, null, now);
    rows = await meetAttempts(db, l);
    st = platformState(rows);
  }
  // the attempt she lifts now, or the last one she sent (its lights, or its wait)
  const cur = st.current;
  if (!cur) return { kind: 'closed', meetName };
  const caps = await lifterCaps(db, l);
  const units = l.units as Units;
  const lift = cur.lift as Lift;
  return {
    kind: 'open', meetName, demo: meet.kind === 'demo', closesAt: meet.closesAt?.toISOString() ?? null,
    row: nineRow(rows, cur),
    current: {
      id: cur.id, lift: cur.lift, number: cur.number, weight: cur.weight, reps_declared: cur.repsDeclared, status: cur.status,
      kind: l.division === 'home' ? homeKind(lift, cur.weight, l.homeWeights) : null,
    },
    because: l.isDemo
      ? demoBecause(l.division, lift, units, now, l.division === 'home' ? cur.repsDeclared : cur.weight)
      : becauseLine(l.division, lift, caps[lift], units, l.division === 'home' ? cur.repsDeclared : cur.weight),
    notJudged: !l.isDemo && !caps[lift].judged,
  };
}
