// What /referee and the demo's bot page show once the referee bot gives the lights (plan 5.33,
// 5.36, look 5.14d): the queue ("<n> deciding · <m> decided today"), and for one close call the
// bot's three lamps and notes, and the frames it read.
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { attempts, lifters, meets, refereeJobs, reviews, type Light, type RefereeFrame } from '@/db/schema';
import type { LampAnswer } from '@/lib/referee/lamps';
import { commandList } from '@/lib/referee/bot';
import type { ReasonCode } from '@/lib/reason-words';

/** Midnight today, Eastern: "decided today" (the meet's clock). */
const TODAY_ET = sql`(date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York')`;

export type BotQueueRow = {
  attemptId: string; lift: string; number: number; weight: number; repsDeclared: number | null; units: string; division: string;
  /** why the judge sent it (the attempt's reason before the lights landed) */
  why: string | null; videoKey: string | null; judgedFrameMs: number | null;
  /** the lights that stand (the bot's, or a person's change); null while the bot decides */
  lights: Light[] | null; decidedAt: Date | null;
};

/**
 * 5.33's queue in bot mode: deciding rows first, oldest first; then decided rows, newest first.
 * Decided rows stay while their meet's board isn't final (so a referee can still change them),
 * and today's stay whatever the board. Demo attempts are the demo lifter's own, never here.
 */
export async function botQueue(db: Db): Promise<{ rows: BotQueueRow[]; deciding: number; decidedToday: number }> {
  const rows = await db.execute<{
    attempt_id: string; lift: string; number: number; weight: number; reps_declared: number | null; units: string; division: string;
    why: string | null; video_key: string | null; judged_frame_ms: number | null; status: string; lights: Light[] | null; decided_at: string | null; today: boolean;
  }>(sql`
    select a.id as attempt_id, a.lift, a.number, a.weight, a.reps_declared, l.units, l.division, a.video_key, a.judged_frame_ms, a.status,
      case when a.status = 'close_call' then a.reason else coalesce(a.measures->>'close_reason', a.reason) end as why,
      a.lights, r.created_at as decided_at, coalesce(r.created_at >= ${TODAY_ET}, false) as today
    from ${attempts} a
    join ${lifters} l on l.id = a.lifter_id
    join ${meets} m on m.id = a.meet_id
    left join lateral (
      select rv.created_at from ${reviews} rv where rv.attempt_id = a.id and rv.by_bot order by rv.created_at desc limit 1
    ) r on true
    where m.kind <> 'demo'
      and (a.status = 'close_call' or (a.status = 'judged' and r.created_at is not null and (m.status <> 'final' or r.created_at >= ${TODAY_ET})))
    order by (a.status = 'close_call') desc,
      case when a.status = 'close_call' then coalesce(a.judged_at, a.uploaded_at, a.created_at) end asc,
      r.created_at desc
    limit 200`);
  const out = rows.map(r => {
    const deciding = r.status === 'close_call';
    return {
      attemptId: r.attempt_id, lift: r.lift, number: Number(r.number), weight: Number(r.weight),
      repsDeclared: r.reps_declared === null ? null : Number(r.reps_declared), units: r.units, division: r.division,
      why: r.why, videoKey: r.video_key, judgedFrameMs: r.judged_frame_ms === null ? null : Number(r.judged_frame_ms),
      lights: deciding ? null : r.lights, decidedAt: deciding || !r.decided_at ? null : new Date(r.decided_at), today: r.today,
    };
  });
  return {
    rows: out.map(r => { const { today, ...row } = r; void today; return row; }),
    deciding: out.filter(r => r.lights === null).length,
    decidedToday: out.filter(r => r.lights !== null && r.today).length,
  };
}

/** "<n> deciding · <m> decided today" (5.33). */
export const botQueueLine = (q: { deciding: number; decidedToday: number }) => `${q.deciding} deciding · ${q.decidedToday} decided today`;

/** "Decided": a time today, and the day too before that, Eastern. */
export function decidedText(d: Date, now = new Date()) {
  const day = (x: Date) => x.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).replace(' AM', ' am').replace(' PM', ' pm');
  return day(d) === day(now) ? time : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}, ${time}`;
}

export type BotLamp = { light: Light; reason: ReasonCode | null; rep: number | null; note: string | null };
export type BotSide =
  | { state: 'deciding' }
  | { state: 'decided'; lamps: BotLamp[]; unavailable: boolean };
export type BotFrame = { n: number; tMs: number; key: string; command: string | null; judged: boolean };

const LAMP_ORDER = ['left', 'head', 'right'] as const;

/**
 * The bot's side of one attempt: its lamps and notes once decided (from the job's answers, or the
 * bot's review's lights and notes), "unavailable" on a doubt (three whites, no notes), the board
 * being final (the page is read only), and 6 of the frames it read around the judged frame.
 */
export async function botSide(db: Db, attemptId: string) {
  const [row] = await db.select({ a: attempts, meetStatus: meets.status }).from(attempts).innerJoin(meets, eq(meets.id, attempts.meetId)).where(eq(attempts.id, attemptId));
  if (!row) return null;
  const [job] = await db.select().from(refereeJobs)
    .where(and(eq(refereeJobs.attemptId, attemptId), eq(refereeJobs.kind, 'lamps'))).orderBy(desc(refereeJobs.createdAt)).limit(1);
  const [review] = await db.select().from(reviews)
    .where(and(eq(reviews.attemptId, attemptId), eq(reviews.byBot, true))).orderBy(desc(reviews.createdAt)).limit(1);
  const m = (row.a.measures ?? null) as Record<string, unknown> | null;
  let side: BotSide | null = null;
  if (row.a.status === 'close_call') side = { state: 'deciding' };
  else if (review) side = sideOf(review, job?.answers ?? null, m);
  return {
    side,
    /** a person changed the bot's lights (they stand) */
    changed: m?.referee_changed === true,
    final: row.meetStatus === 'final',
    frames: job ? pickFrames(job.frames ?? [], row.a.judgedFrameMs, row.a.commandTimes as Record<string, number> | null) : [],
  };
}

export function sideOf(review: { lights: Light[] | null; lampNotes: (string | null)[] | null; reason: string | null }, answers: unknown[] | null, m: Record<string, unknown> | null): BotSide {
  const unavailable = review.reason === 'referee_unavailable' || m?.referee_unavailable === true;
  if (unavailable) return { state: 'decided', unavailable: true, lamps: [0, 1, 2].map(() => ({ light: 'white' as Light, reason: null, rep: null, note: null })) };
  const lights = review.lights ?? ['white', 'white', 'white'];
  const byLamp = new Map<string, LampAnswer>();
  for (const x of answers ?? []) {
    const o = x as LampAnswer & { lamp?: string };
    if (o && typeof o.lamp === 'string') byLamp.set(o.lamp, o);
  }
  const lightReasons = Array.isArray(m?.light_reasons) ? (m!.light_reasons as (string | null)[]) : [];
  return {
    state: 'decided', unavailable: false,
    lamps: LAMP_ORDER.map((name, i) => {
      const a = byLamp.get(name);
      const light = lights[i] ?? 'white';
      return {
        light,
        reason: light === 'red' ? ((a?.reason ?? lightReasons[i] ?? null) as ReasonCode | null) : null,
        rep: light === 'red' ? (a?.rep ?? null) : null,
        note: review.lampNotes?.[i] ?? a?.note ?? null,
      };
    }),
  };
}

/** 5.36: 6 of the frames it read, the flagged moment's, in time order, the judged frame ringed. */
export function pickFrames(frames: RefereeFrame[], judgedMs: number | null, ct: Record<string, number> | null, n = 6): BotFrame[] {
  const fs = frames.filter(f => !f.attempt_id).slice().sort((a, b) => a.t_ms - b.t_ms);
  if (!fs.length) return [];
  const at = judgedMs ?? fs[Math.floor(fs.length / 2)].t_ms;
  let best = 0;
  fs.forEach((f, i) => { if (Math.abs(f.t_ms - at) < Math.abs(fs[best].t_ms - at)) best = i; });
  const start = Math.max(0, Math.min(fs.length - n, best - Math.floor((n - 1) / 2)));
  const commands = commandList(ct);
  return fs.slice(start, start + n).map(f => ({
    n: f.n, tMs: f.t_ms, key: f.key, judged: f === fs[best],
    command: commands.filter(([t]) => t <= f.t_ms).at(-1)?.[1] ?? null,
  }));
}

/** "Frame at 2.40 s, after Squat!" (look 5.14d), from the frame's own time and command. */
export const frameAlt = (f: { tMs: number; command: string | null }) =>
  `Frame at ${(f.tMs / 1000).toFixed(2)} s${f.command ? `, after ${f.command}` : ''}`;
