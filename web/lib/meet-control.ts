// Meet control (plan 5.35, `/host/control`, admins and the host): the meet night's switches.
// - "Open the platform" / "Close the platform" (with a confirm), and the times (Eastern)
// - "YouTube live video ID", "Soo went live now" (editable), "Live length (minutes)"
// - "Make the board final": only when no close calls wait, the spot checks are done, and the clip
//   deadline has passed; it writes the awards and the board goes public
// - "Replay video ID": every "Watch the moment" then opens the replay at the moment; each lifter who
//   was read or crossed gets one email with her moment ("We'll email you", 5.29)
// - "Status message": a Sheet title and a sentence for /status (5.7)
import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { remakeAtFinal } from '@/lib/card/clip-remake';
import type { Db } from '@/db';
import { awards as awardsTable, emails, lifters, meets, readouts } from '@/db/schema';
import { awards } from '@/lib/board';
import { queueEmail } from '@/lib/email';
import { meetLifters, momentLink, timeWords, type MeetRow } from '@/lib/host-data';
import { boardFinalReady } from '@/lib/meet-window';
import { getSetting, setSetting } from '@/lib/referee/bot';

/** The meet control works on: the first real (or staging's test) meet whose board isn't final yet; else the last one made final. */
// With `slug` (the meet a form was posted from, or the one a post went back to), that meet when it is one
// control works on, so making a board final doesn't move the page to the next meet.
export async function controlMeet(db: Db, slug?: string | null): Promise<MeetRow | null> {
  if (slug) {
    const [it] = await db.select().from(meets).where(and(eq(meets.slug, slug), inArray(meets.kind, ['real', 'test']))).limit(1);
    if (it) return it;
  }
  const [open] = await db.select().from(meets).where(and(inArray(meets.kind, ['real', 'test']), ne(meets.status, 'final')))
    .orderBy(sql`${meets.opensAt} asc nulls last`, asc(meets.slug)).limit(1);
  if (open) return open;
  const [last] = await db.select().from(meets).where(inArray(meets.kind, ['real', 'test'])).orderBy(sql`${meets.opensAt} desc nulls last`).limit(1);
  return last ?? null;
}

// ---------- Eastern times in a form ----------

const ET = 'America/New_York';

/** A moment as an `<input type="datetime-local">` value, on Eastern clocks: "2027-02-26T06:00". */
export function etInput(d: Date | null): string {
  if (!d) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** An Eastern wall time from the form back to the moment; null for blank or nonsense. A skipped hour (spring forward) moves on an hour. */
export function etFromInput(v: unknown): Date | null {
  const m = typeof v === 'string' ? v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  for (const off of [5, 4]) {
    const t = new Date(Date.UTC(y, mo - 1, d, h + off, mi));
    if (etInput(t) === v) return t;
  }
  return new Date(Date.UTC(y, mo - 1, d, h + 4, mi));
}

/** The meet's times as the page says them: "Fri Feb 26, 6:00 am". */
export const etWords = (d: Date | null) => d
  ? d.toLocaleString('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(/ (AM|PM)$/, (_, x: string) => ` ${x.toLowerCase()}`)
  : 'Not set';

// ---------- the video IDs ----------

/** A YouTube video ID, from the ID itself or a pasted link (watch?v=, youtu.be/, /live/, /embed/, /shorts/). Null if it isn't one. */
export function youtubeId(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u: URL;
  try { u = new URL(s.includes('://') ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.replace(/^(www\.|m\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:live|embed|shorts)\/([^/]+)/)?.[1] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

// ---------- the status message (5.7) ----------

export const STATUS_TITLE_KEY = 'status_title';
export const STATUS_SENTENCE_KEY = 'status_sentence';

export async function statusMessage(db: Db): Promise<{ title: string; sentence: string } | null> {
  const [title, sentence] = await Promise.all([getSetting(db, STATUS_TITLE_KEY), getSetting(db, STATUS_SENTENCE_KEY)]);
  return title || sentence ? { title: title ?? '', sentence: sentence ?? '' } : null;
}

/** Both blank clears it. */
export async function setStatusMessage(db: Db, title: string, sentence: string) {
  const t = title.trim().slice(0, 80), s = sentence.trim().slice(0, 280);
  await setSetting(db, STATUS_TITLE_KEY, t || null);
  await setSetting(db, STATUS_SENTENCE_KEY, s || null);
}

// ---------- the replay's emails ----------

/**
 * The replay is saved: each real lifter Soo read, or whose name crossed, gets one email with her
 * moment (a read before a crossing). Never twice for a meet; never a demo lifter; never without an email.
 */
export async function queueReplayEmails(db: Db, meet: MeetRow): Promise<number> {
  const rows = await db.select({ id: readouts.id, lifterId: readouts.lifterId, kind: readouts.kind, at: readouts.at })
    .from(readouts).innerJoin(lifters, eq(lifters.id, readouts.lifterId))
    .where(and(eq(readouts.meetId, meet.id), eq(lifters.isDemo, false), isNotNull(lifters.email)));
  if (!rows.length) return 0;
  const mine = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const had = mine.get(r.lifterId);
    if (!had || (r.kind === 'read' && had.kind !== 'read') || (r.kind === had.kind && r.at < had.at)) mine.set(r.lifterId, r);
  }
  const already = await db.select({ lifterId: emails.lifterId }).from(emails)
    .innerJoin(readouts, eq(readouts.id, emails.readoutId))
    .where(and(eq(emails.kind, 'replay'), eq(readouts.meetId, meet.id), inArray(emails.lifterId, [...mine.keys()])));
  const sent = new Set(already.map(a => a.lifterId));
  let n = 0;
  for (const r of mine.values()) {
    if (sent.has(r.lifterId)) continue;
    const e = replayEmail(r.kind as 'read' | 'rollcall', r.at, momentLink(r.id));
    await queueEmail(db, { lifterId: r.lifterId, kind: 'replay', readoutId: r.id, ...e });
    n++;
  }
  return n;
}

export function replayEmail(kind: 'read' | 'rollcall', at: Date, link: string) {
  return {
    subject: "Soo's meet night replay is up",
    body: `The replay of meet night is saved. ${kind === 'read' ? 'Soo read your name' : 'Your name and total crossed the screen'} at ${timeWords(at)} Eastern. Watch the moment: ${link}`,
  };
}

// ---------- the switches ----------

export type ControlAction =
  | { do: 'open' } | { do: 'close' }
  | { do: 'times'; opensAt: Date | null; closesAt: Date | null; liveAt: Date | null }
  | { do: 'stream'; id: string | null }
  | { do: 'went_live'; at: Date }
  | { do: 'live_minutes'; minutes: number }
  | { do: 'final' }
  | { do: 'replay'; id: string | null }
  | { do: 'status'; title: string; sentence: string };

/** The form's fields to an action, or the sentence that says what's wrong. */
export function parseControl(f: (k: string) => string | null, now = new Date()): ControlAction | { error: string } {
  const what = f('do');
  switch (what) {
    case 'open': case 'close': case 'final': return { do: what };
    case 'times': {
      const [opensAt, closesAt, liveAt] = ['opens_at', 'closes_at', 'live_at'].map(k => etFromInput(f(k)));
      if (opensAt && closesAt && closesAt <= opensAt) return { error: 'The platform has to close after it opens.' };
      return { do: 'times', opensAt, closesAt, liveAt };
    }
    case 'stream': case 'replay': {
      const raw = (f('video_id') ?? '').trim();
      if (!raw) return { do: what, id: null };
      const id = youtubeId(raw);
      return id ? { do: what, id } : { error: "That isn't a YouTube video ID or link." };
    }
    case 'went_live': {
      const given = f('at');
      if (!given) return { do: 'went_live', at: now };
      const at = etFromInput(given);
      return at ? { do: 'went_live', at } : { error: 'Give the time Soo went live, Eastern.' };
    }
    case 'live_minutes': {
      const n = Number(f('minutes'));
      return Number.isInteger(n) && n >= 10 && n <= 300 ? { do: 'live_minutes', minutes: n } : { error: 'Live length is 10 to 300 minutes.' };
    }
    case 'status': return { do: 'status', title: f('title') ?? '', sentence: f('sentence') ?? '' };
    default: return { error: 'Unknown action.' };
  }
}

/** Does it. Returns a sentence for the page when it can't, or a note when it did something worth saying. */
export async function runControl(db: Db, meet: MeetRow, a: ControlAction, now = new Date()): Promise<{ ok: boolean; note?: string }> {
  const set = (v: Partial<typeof meets.$inferInsert>) => db.update(meets).set(v).where(eq(meets.id, meet.id));
  switch (a.do) {
    case 'open': {
      // the times decide when it's open (5.24): opening now pulls the opening time to now
      if (meet.status === 'final') return { ok: false, note: 'The board is final: the platform stays closed.' };
      if (meet.closesAt && meet.closesAt <= now) return { ok: false, note: 'Set a closing time after now first.' };
      if (!meet.closesAt) return { ok: false, note: 'Set the closing time first.' };
      await set({ status: 'open', opensAt: !meet.opensAt || meet.opensAt > now ? now : meet.opensAt });
      return { ok: true };
    }
    case 'close':
      if (meet.status === 'final') return { ok: true };
      await set({ status: 'closed' });
      return { ok: true };
    case 'times':
      await set({ opensAt: a.opensAt, closesAt: a.closesAt, liveAt: a.liveAt });
      return { ok: true };
    case 'stream':
      await set({ streamVideoId: a.id });
      return { ok: true };
    case 'went_live':
      await set({ streamStartedAt: a.at });
      return { ok: true };
    case 'live_minutes':
      await set({ liveMinutes: a.minutes });
      return { ok: true };
    case 'final': {
      if (meet.status === 'final') return { ok: true };
      const ready = await boardFinalReady(db, meet, now);
      if (!ready.ok) return { ok: false, note: ready.line ?? 'Not yet: close calls or spot checks are still waiting.' };
      const list = await meetLifters(db, meet.id);
      const won = awards(list, true);
      await db.transaction(async tx => {
        await tx.delete(awardsTable).where(eq(awardsTable.meetId, meet.id));
        if (won.length) await tx.insert(awardsTable).values(won.map(w => ({ meetId: meet.id, lifterId: w.lifterId, kind: w.kind }))).onConflictDoNothing();
        await tx.update(meets).set({ status: 'final' }).where(eq(meets.id, meet.id));
      });
      // item 119 (held): one sweep for any made clip whose end card still differs, made now. No change, no run.
      await remakeAtFinal(db, meet.id, now);
      return { ok: true };
    }
    case 'replay': {
      await set({ replayVideoId: a.id });
      if (!a.id) return { ok: true };
      const n = await queueReplayEmails(db, { ...meet, replayVideoId: a.id });
      return { ok: true, note: n ? `${n} replay ${n === 1 ? 'email' : 'emails'} on the way.` : undefined };
    }
    case 'status':
      await setStatusMessage(db, a.title, a.sentence);
      return { ok: true };
  }
}
