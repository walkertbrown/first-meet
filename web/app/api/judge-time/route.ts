// POST /api/judge-time: the phone's judge time for a Try a lift clip (web/lib/judge-time.ts).
// One JSON log line (phase 1), and from phase 2 an events row, phone_judge_time, for /ops SPEED.
import { judgeTimeLine, parseJudgeTime } from '@/lib/judge-time';
import { db, hasDb } from '@/db';
import { logEvent } from '@/lib/queue';

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > 2000) return new Response(null, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
  const j = parseJudgeTime(body);
  if (!j) return new Response(null, { status: 400 });
  console.log(judgeTimeLine(j));
  if (hasDb()) {
    try { await logEvent(db(), 'phone_judge_time', { ...j }); } catch (e) { console.log(JSON.stringify({ msg: 'judge-time event failed', error: (e as Error).message })); }
  }
  return new Response(null, { status: 204 });
}
