// The platform page on the server (plan 5.24–5.28): where she is in the nine, the window's state,
// the card for the attempt she lifts now, and the 9-attempt row. The rules are web/lib/meet.ts and
// web/lib/meet-flow.ts; this only puts them together for the page.
import type { Db } from '@/db';
import type { Lift } from '@/db/schema';
import { ORDER, homeKind, platformState, type Units } from '@/lib/meet';
import { declareNext, lifterCaps, meetAttempts, platformOpen, type AttemptRow, type LiftCap, type LifterRow } from '@/lib/meet-flow';
import { demoBecause } from '@/lib/demo';
import { PLAN_SWITCHES } from '@/lib/plan-switches';
import { capSentence } from '@/lib/stage/meet-words';

/** One cell of the 9-attempt row (look 4, plan 5.27). */
export type RowCell = {
  lift: Lift; number: number;
  /** declared: on her card; now: the one she lifts or looks at; lit: judged; waiting: a close call */
  state: 'empty' | 'declared' | 'now' | 'sent' | 'waiting' | 'white' | 'red';
};

export type CardAttempt = {
  id: string; lift: string; number: number; weight: number; reps_declared: number | null; status: string;
  kind: 'pair' | 'bell' | null;
};

/** One of her nine after the meet, as "See my lifts" lists it. */
export type DoneAttempt = { id: string; lift: Lift; number: number; weight: number; reps: number | null; call: 'white' | 'red' | 'close' | null; lights: ('white' | 'red')[] };

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
 * Item 76: at exactly her cap (`declared`: the weight on Barbell, the reps on Home), "lighter" and
 * "fewer" aren't true, so the second sentence says "the same".
 */
export function becauseLine(division: 'barbell' | 'home', lift: Lift, cap: LiftCap, units: Units, declared?: number | null, item76 = PLAN_SWITCHES.item76): string {
  const same = item76 && declared != null && declared === cap.cap;
  if (!cap.judged || !cap.at) {
    if (same) return division === 'home' ? 'The same as your best logged set. Not judged in training yet.' : 'The same weight as your best logged triple, for just one. Not judged in training yet.';
    return division === 'home' ? 'Fewer than your best logged set. Not judged in training yet.' : 'Lighter than your best logged triple. Not judged in training yet.';
  }
  const date = shortDate(cap.at);
  if (division === 'home') return `You did ${cap.cap} at ${cap.weight} ${units} with white lights on ${date}. ${capSentence('home', same)}`;
  return `You ${PAST[lift]} ${cap.cap} for 3 with white lights on ${date}. ${capSentence('barbell', same)}`;
}

/** The 9-attempt row: every slot, in the meet's order. */
export function nineRow(rows: Pick<AttemptRow, 'lift' | 'number' | 'status' | 'call'>[], current: { lift: string; number: number } | null): RowCell[] {
  return ORDER.map(slot => {
    const a = rows.find(r => r.lift === slot.lift && r.number === slot.number);
    const now = !!current && current.lift === slot.lift && current.number === slot.number;
    let state: RowCell['state'] = 'empty';
    if (a) {
      if (a.call === 'white' || a.call === 'red') state = a.call;
      else if (a.call === 'close' || a.status === 'close_call') state = 'waiting';
      else if (now) state = 'now';
      else state = a.status === 'declared' ? 'declared' : 'sent';
    }
    return { lift: slot.lift, number: slot.number, state };
  });
}

/**
 * What /platform shows her now (5.24). With nothing on her card yet and the window open, her next
 * opener is declared for her (5.25 step 11: "Next: <lift>" has no sheet). After all nine have
 * lights or a close call, it's the total (5.28).
 */
export async function platformView(db: Db, l: LifterRow, meet: { kind: string; status: string; name: string; opensAt: Date | null; closesAt: Date | null }, now = new Date()): Promise<PlatformView> {
  const meetName = meet.name;
  let rows = await meetAttempts(db, l);
  if (meet.kind !== 'demo' && meet.opensAt && now < meet.opensAt) return { kind: 'before', opensAt: meet.opensAt.toISOString(), closesAt: meet.closesAt?.toISOString() ?? null, meetName };
  const open = platformOpen(meet as Parameters<typeof platformOpen>[0], now);
  let st = platformState(rows);
  if (!open) {
    // uploads left pending at close keep uploading (3.8); with none lifted, the closed page
    const lifted = rows.some(a => a.status !== 'declared');
    if (!lifted) return { kind: 'closed', meetName };
  }
  if (st.done && st.current && ['judged', 'close_call'].includes(st.current.status)) {
    const nine = ORDER.map(s => rows.find(a => a.lift === s.lift && a.number === s.number)!).map(a => ({
      id: a.id, lift: a.lift, number: a.number, weight: a.weight, reps: a.repsDeclared,
      call: (a.call ?? null) as DoneAttempt['call'],
      lights: ((a.lights ?? []) as string[]).filter((x): x is 'white' | 'red' => x === 'white' || x === 'red'),
    }));
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
