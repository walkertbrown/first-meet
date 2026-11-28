// `/referee/spot` (plan 5.33): each lifter now in a top 3 (and one a spot red took out of it, while the red
// stands), with all nine clips, the bot's line, and a person's finding if one stands. The lifter's name is never shown: only division, age group and place.
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { meets, refereeJobs, spotChecks, type SpotFinding } from '@/db/schema';
import { boardRows } from '@/lib/board';
import { meetLifters } from '@/lib/host-data';
import { hasR2, r2 } from '@/lib/r2';
import { botOn } from '@/lib/referee/words';
import { divisionName, liftName, weightText } from '@/lib/referee-view';
import { botLine, spotAttempts, topThree } from './spot';

export type SpotDeskClip = { attemptId: string; hud: string; name: string; weight: string; video: string | null; press: boolean; light: 'white' | 'red' | 'off' };
export type SpotDeskRow = {
  lifterId: string; group: string; place: string; clips: SpotDeskClip[]; botLine: string; person: SpotFinding | null; done: boolean;
};
export type SpotDesk = { meetName: string; final: boolean; rows: SpotDeskRow[]; toCheck: number; checked: number } | null;

/** The place of a held lifter whose red left her with no total. */
export const NO_TOTAL = 'No total';
/** A finding whose problem made an attempt red ("not the same lifter" makes nothing red). */
const redStands = (f: SpotFinding | null) => !!f && f.outcome === 'problem' && f.problems.some(p => p.kind !== 'not_same_lifter');

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** The meet being checked: one past its clip deadline and not final, else the last one made final. */
async function deskMeet(db: Db) {
  const open = await db.select().from(meets).where(and(sql`${meets.kind} in ('real', 'test')`, sql`${meets.status} <> 'final'`, sql`${meets.closesAt} is not null`))
    .orderBy(meets.closesAt);
  const { pastDeadline } = await import('@/lib/meet-window');
  const now = new Date();
  const due = open.find(m => pastDeadline(m, now));
  if (due) return due;
  const [last] = await db.select().from(meets).where(and(sql`${meets.kind} in ('real', 'test')`, eq(meets.status, 'final'))).orderBy(desc(meets.closesAt)).limit(1);
  return last ?? null;
}

export async function spotDesk(db: Db, env: Record<string, string | undefined> = process.env, meetId?: string): Promise<SpotDesk> {
  const m = meetId ? (await db.select().from(meets).where(eq(meets.id, meetId)))[0] : await deskMeet(db);
  if (!m) return null;
  // the top 3 is worked out again on every look (3.4d step 8), with the bot's own tick: a row made here
  // gets its job here (the row's insert is the lock), so a person can decide before the worker's next tick
  if (m.status !== 'final') await (await import('./bot')).spotTick(db, env);
  const list = await meetLifters(db, m.id);
  const top = topThree(list);
  const checks = await db.select({ s: spotChecks, job: refereeJobs.status }).from(spotChecks).leftJoin(refereeJobs, eq(refereeJobs.id, spotChecks.jobId))
    .where(eq(spotChecks.meetId, m.id));
  const by = new Map(checks.map(c => [c.s.lifterId, c]));
  // a lifter whose spot check made an attempt red stays on the page while that red stands, even when
  // the red took her out of the top 3: "Checked" is how a person puts it back (5.33, 3.4d step 8)
  const held = checks.filter(c => !top.includes(c.s.lifterId) && redStands(c.s.person ?? c.s.bot)).map(c => c.s.lifterId);
  if (!top.length && !held.length) return { meetName: m.name, final: m.status === 'final', rows: [], toCheck: 0, checked: 0 };
  // the board's order: Barbell then Home, each age group's top 3 by place (look 5.13a: one group each)
  const place = new Map<string, { group: string; place: string }>();
  for (const d of ['barbell', 'home'] as const) {
    const n = new Map<string, number>();
    for (const r of boardRows(list, d, true)) {
      const k = (n.get(r.ageGroup) ?? 0) + 1;
      n.set(r.ageGroup, k);
      place.set(r.id, { group: `${divisionName(d)} · ${r.ageGroup}`, place: `${ordinal(k)} · ${r.totalText} ${r.units}` });
    }
  }
  const groupOf = (id: string) => {
    const l = list.find(x => x.id === id)!;
    return place.get(id)?.group ?? `${divisionName(l.division)} · ${l.ageGroup ?? 'Open'}`;
  };
  // each held lifter goes after her group's top 3
  const order = [...top];
  for (const id of held) {
    const g = groupOf(id);
    const last = order.map(groupOf).lastIndexOf(g);
    order.splice(last < 0 ? order.length : last + 1, 0, id);
  }
  const rows: SpotDeskRow[] = [];
  for (const id of order) {
    const l = list.find(x => x.id === id)!;
    const c = by.get(id);
    const mine = await spotAttempts(db, id);
    const clips: SpotDeskClip[] = await Promise.all(mine.map(async a => ({
      attemptId: a.id, hud: `${liftName(a.lift, l.division).toUpperCase()} · ${a.number}`, name: `${liftName(a.lift, l.division)} ${a.number}`,
      weight: weightText(a.weight, l.units, a.repsDeclared),
      video: hasR2() && a.videoKey ? await r2().signedGet(a.videoKey).catch(() => null) : null,
      press: l.division === 'home' && a.lift === 'bench', light: a.call === 'white' ? 'white' as const : a.call === 'red' ? 'red' as const : 'off' as const,
    })));
    const labelOf = (aid: string) => clips.find(x => x.attemptId === aid)?.name ?? 'an attempt';
    const at = place.get(id);
    rows.push({
      lifterId: id, group: groupOf(id), place: at?.place ?? NO_TOTAL, clips, person: c?.s.person ?? null,
      botLine: botLine({ bot: c?.s.bot ?? null, job: c?.job ? { status: c.job } : null, botOn: botOn(env) }, labelOf),
      done: !!(c?.s.person || c?.s.bot),
    });
  }
  const checked = rows.filter(r => r.done).length;
  return { meetName: m.name, final: m.status === 'final', rows, toCheck: rows.length - checked, checked };
}
