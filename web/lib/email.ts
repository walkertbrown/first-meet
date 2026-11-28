// Email (plan 2: Resend, sender First Meet <meet@mail.bananafest-destiny.com>). Everything waits in
// `emails` and goes out in kind order, up to the day's limit (The Playner, Nov 28):
//   1. sign-in links (phase 6), so she can always get in;
//   2. "Soo just read your name";
//   3. the roll call's;
//   4. the replay's ("We'll email you").
// At the limit, sending stops for the day (UTC, as Resend counts it) and /ops says "Email limit
// reached today" with the count not sent. With no RESEND_API_KEY, each email is logged and marked
// `no_key`: nothing is sent, and nothing piles up to go out late once a key is set.
import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { emails, events, type EmailKind } from '@/db/schema';

export const SENDER = 'First Meet <meet@mail.bananafest-destiny.com>';
export const KIND_ORDER: EmailKind[] = ['signin', 'read', 'rollcall', 'replay'];
/** Resend's free plan: 100 a day (#resend-pro would lift it). */
export const dayLimit = (env = process.env) => Math.max(0, Number(env.EMAIL_DAY_LIMIT ?? 100) || 0);

export type Sent = { ok: true; id: string } | { ok: false; limit: boolean; error: string };
export type Sender = (m: { to: string; subject: string; text: string }) => Promise<Sent>;

/** Resend's REST API: one email. A 429 that says the day's quota is used is the limit. */
export function resendSender(key: string, fetcher: typeof fetch = fetch): Sender {
  return async ({ to, subject, text }) => {
    const r = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: SENDER, to: [to], subject, text }),
    }).catch((e: Error) => ({ ok: false, status: 0, text: async () => e.message }) as unknown as Response);
    const body = await r.text().catch(() => '');
    if (r.ok) {
      try { return { ok: true, id: String((JSON.parse(body) as { id?: string }).id ?? '') }; } catch { return { ok: true, id: '' }; }
    }
    const limit = r.status === 429 && /quota/i.test(body);
    return { ok: false, limit, error: `${r.status} ${body.slice(0, 200)}` };
  };
}

export const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Whether the limit was reached in this UTC day. */
async function limitHit(db: Db, now: Date) {
  const day = startOfUtcDay(now);
  const [r] = await db.execute<{ n: number }>(sql`select count(*)::int as n from events where kind = 'email_limit'
    and at >= ${day.toISOString()} and at < ${new Date(day.getTime() + 86_400_000).toISOString()}`);
  return r.n > 0;
}

/** Queues one email. `sendAfter` lets a read-out's wait for her phone to say it showed it. */
export async function queueEmail(db: Db, e: { lifterId: string; kind: EmailKind; subject: string; body: string; readoutId?: string | null; sendAfter?: Date }) {
  const [row] = await db.insert(emails).values({ ...e, readoutId: e.readoutId ?? null, sendAfter: e.sendAfter ?? new Date() }).returning({ id: emails.id });
  return row.id;
}

/** Sent so far today, and waiting now (due) but not sent. */
export async function emailDay(db: Db, now = new Date()) {
  const day = startOfUtcDay(now).toISOString();
  const [r] = await db.execute<{ sent: number; waiting: number }>(sql`
    select (select count(*)::int from emails where status = 'sent' and sent_at >= ${day}) as sent,
           (select count(*)::int from emails where status = 'waiting' and send_after <= ${now.toISOString()}) as waiting`);
  return r;
}

/** /ops's line (The Playner, Nov 28), or null while under the limit. */
export async function emailLimitLine(db: Db, now = new Date(), env = process.env): Promise<string | null> {
  const { sent, waiting } = await emailDay(db, now);
  if (sent < dayLimit(env) && !(await limitHit(db, now))) return null;
  return `Email limit reached today: ${waiting.toLocaleString('en-US')} not sent.`;
}

export type MailResult = { sent: number; noKey: number; failed: number; limited: boolean };

/**
 * One pass: the due emails, in kind order then oldest first, each claimed with SKIP LOCKED so two
 * web instances never send one twice. Stops at the day's limit (ours, or Resend's 429).
 */
export async function sendDue(db: Db, send: Sender | null, now = new Date(), env = process.env, most = 20): Promise<MailResult> {
  const out: MailResult = { sent: 0, noKey: 0, failed: 0, limited: false };
  const limit = dayLimit(env);
  const day = startOfUtcDay(now);
  // Resend said stop earlier today: nothing more until tomorrow
  if (send && (await limitHit(db, now))) return { ...out, limited: true };
  for (let i = 0; i < most; i++) {
    const stop = await db.transaction(async tx => {
      const [{ sent }] = await tx.execute<{ sent: number }>(sql`select count(*)::int as sent from emails where status = 'sent' and sent_at >= ${day.toISOString()}`);
      const [row] = await tx.execute<{ id: string; kind: EmailKind; subject: string; body: string; email: string | null }>(sql`
        select e.id, e.kind, e.subject, e.body, l.email
        from emails e join lifters l on l.id = e.lifter_id
        where e.status = 'waiting' and e.send_after <= ${now.toISOString()}
        order by array_position(${sql.raw(`array[${KIND_ORDER.map(k => `'${k}'`).join(',')}]`)}::text[], e.kind), e.send_after, e.created_at
        limit 1 for update of e skip locked`);
      if (!row) return true;
      if (!row.email) {
        await tx.update(emails).set({ status: 'failed', error: 'no address' }).where(sql`id = ${row.id}`);
        out.failed++;
        return false;
      }
      if (!send) {
        console.log(JSON.stringify({ msg: 'email not sent: no RESEND_API_KEY', kind: row.kind, subject: row.subject, email_id: row.id }));
        await tx.update(emails).set({ status: 'no_key' }).where(sql`id = ${row.id}`);
        out.noKey++;
        return false;
      }
      if (sent >= limit) { out.limited = true; return true; }
      const r = await send({ to: row.email, subject: row.subject, text: row.body });
      if (r.ok) {
        await tx.update(emails).set({ status: 'sent', sentAt: now, providerId: r.id || null }).where(sql`id = ${row.id}`);
        out.sent++;
        return false;
      }
      if (r.limit) { out.limited = true; return true; }
      await tx.update(emails).set({ status: 'failed', error: r.error }).where(sql`id = ${row.id}`);
      console.log(JSON.stringify({ msg: 'email failed', kind: row.kind, email_id: row.id, error: r.error }));
      out.failed++;
      return false;
    });
    if (stop) break;
  }
  if (out.limited) {
    if (!(await limitHit(db, now))) {
      await db.insert(events).values({ kind: 'email_limit', detail: { limit }, at: now });
      console.log(JSON.stringify({ msg: 'email limit reached today', limit }));
    }
  }
  return out;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Every 5 s, once per process (instrumentation-node.ts). A read-out's email is due 50 s after it, so it goes within the minute. */
export function startMailer(db: Db, everyMs = 5000, env = process.env) {
  if (timer) return;
  const send = env.RESEND_API_KEY ? resendSender(env.RESEND_API_KEY) : null;
  let busy = false;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await sendDue(db, send, new Date(), env);
      if (r.sent || r.failed) console.log(JSON.stringify({ msg: 'mail', ...r }));
    } catch (e) {
      console.log(JSON.stringify({ msg: 'mail error', error: (e as Error).message }));
    } finally {
      busy = false;
    }
  }, everyMs);
  timer.unref?.();
}
