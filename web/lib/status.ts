// The public status page (plan 5.7): three rows, each a mini lamp lit white for normal and unlit for
// a problem (never red), and the incident card from meet control's status message.
import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { judgingState, type Judging } from '@/lib/attempt-state';
import { statusMessage } from '@/lib/meet-control';
import { UPLOADS_OVER } from '@/lib/ops';

export type StatusRow = { label: string; value: string; ok: boolean };

/** "Lifting and recording": having trouble when, over 15 minutes, over 5% of uploads failed or were refused (at least 3). */
export const recordingTrouble = (tried: number, failed: number) => failed >= 3 && failed > tried * UPLOADS_OVER;

/** The normal row's seconds: the median, up to the next 10 s. */
export const tenUp = (s: number) => Math.max(10, Math.ceil(s / 10) * 10);

export function judgingWords(state: Judging, medianS: number | null, minutes: number | null): string {
  if (state === 'paused') return "Paused: your lifts are saved and will be judged when it's back";
  if (state === 'busy') return `Busy: lights are taking about ${minutes} minutes`;
  return medianS == null ? 'Lights are taking about a minute' : `Lights are taking about ${tenUp(medianS)} seconds`;
}

/** "<N> waiting · about <N> minutes": the median frames-ready-to-lights over the last hour, up, at least 1. */
export function botWords(waiting: number, medianS: number | null): string {
  const m = Math.max(1, Math.ceil((medianS ?? 0) / 60));
  return `${waiting.toLocaleString('en-US')} waiting · about ${m} ${m === 1 ? 'minute' : 'minutes'}`;
}

export async function platformStatus(db: Db): Promise<{ rows: StatusRow[]; incident: { title: string; sentence: string } | null }> {
  const [[n], judging, incident] = await Promise.all([
    db.execute<{ tried: number; failed: number; lights_s: number | null; waiting: number; bot_s: number | null }>(sql`
      select
        (select count(*)::int from events where at > now() - interval '15 minutes'
           and (kind = 'upload_started' or (kind = 'upload_failed' and (detail->>'before_start')::boolean))) as tried,
        (select count(*)::int from events where at > now() - interval '15 minutes' and kind in ('upload_failed', 'upload_refused')) as failed,
        (select percentile_cont(0.5) within group (order by (detail->>'upload_to_lights_s')::float)
           from events where kind = 'judged' and at > now() - interval '15 minutes' and detail->>'upload_to_lights_s' is not null) as lights_s,
        (select count(*)::int from referee_jobs where status in ('waiting_frames', 'ready', 'running')) as waiting,
        (select percentile_cont(0.5) within group (order by extract(epoch from decided_at - frames_ready_at))::float
           from referee_jobs where status = 'done' and decided_at > now() - interval '1 hour' and frames_ready_at is not null) as bot_s`),
    judgingState(db),
    statusMessage(db),
  ]);
  const trouble = recordingTrouble(Number(n?.tried ?? 0), Number(n?.failed ?? 0));
  const lightsS = n?.lights_s == null ? null : Number(n.lights_s);
  return {
    rows: [
      { label: 'Lifting and recording', value: trouble ? 'Having trouble' : 'Normal', ok: !trouble },
      { label: 'Judging', value: judgingWords(judging.state, lightsS, judging.minutes), ok: judging.state === 'normal' },
      { label: 'Referee bot', value: botWords(Number(n?.waiting ?? 0), n?.bot_s == null ? null : Number(n.bot_s)), ok: true },
    ],
    incident,
  };
}
