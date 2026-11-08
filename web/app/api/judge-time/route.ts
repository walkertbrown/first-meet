// POST /api/judge-time: the phone's judge time for a Try a lift clip (web/lib/judge-time.ts).
import { judgeTimeLine, parseJudgeTime } from '@/lib/judge-time';

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > 2000) return new Response(null, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
  const j = parseJudgeTime(body);
  if (!j) return new Response(null, { status: 400 });
  console.log(judgeTimeLine(j));
  return new Response(null, { status: 204 });
}
