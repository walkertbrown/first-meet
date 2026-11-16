// What the uptime check watches beyond "up" (plan 2.4), sent with /healthz but never failing it, so
// Render's health check doesn't restart the web service over a slow queue or a stopped referee bot.
import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { botWatch } from '@/lib/referee/bot';

export type Watch = { oldest_queued_age_s: number | null; referee_bot: { not_running: string; for_s: number } | null };

export async function watchNumbers(db: Db, env: Record<string, string | undefined> = process.env): Promise<Watch> {
  const [q] = await db.execute<{ s: number | null }>(sql`
    select extract(epoch from now() - min(enqueued_at))::int as s from judge_queue where kind = 'poses'`);
  const bot = await botWatch(db, env);
  return {
    oldest_queued_age_s: q?.s === null || q?.s === undefined ? null : Number(q.s),
    referee_bot: bot ? { not_running: bot.reason, for_s: bot.forS } : null,
  };
}
