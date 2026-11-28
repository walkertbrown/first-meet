// The Node side of instrumentation.ts: the mailer (plan 2), the dispatcher's 2-second loop (plan 3.9), when there's a
// database and a Render key, and the referee bot's worker (3.4d step 6), when there's a database
// and R2. Without them (dev, CI's build) there's nothing to start.
import { db } from '@/db';
import { budgetsFromEnv, startDispatcher } from '@/lib/dispatcher';
import { dayLimit, startMailer } from '@/lib/email';
import { hasR2, r2 } from '@/lib/r2';
import { botOn, startRefereeBot, testAnswersAllowed } from '@/lib/referee/bot';

export function start() {
  if (!process.env.DATABASE_URL) return;
  // The worker runs even with REFEREE_BOT off: staging's test answers send one job to it (item 103).
  if (hasR2() && process.env.REFEREE_WORKER !== 'off') {
    startRefereeBot(db(), r2());
    console.log(JSON.stringify({ msg: 'referee bot worker started', on: botOn(), test_answers: testAnswersAllowed() }));
  }
  // Email (plan 2): with no RESEND_API_KEY it logs each one instead (MAILER=off stops it)
  if (process.env.MAILER !== 'off') {
    startMailer(db());
    console.log(JSON.stringify({ msg: 'mailer started', resend: !!process.env.RESEND_API_KEY, day_limit: dayLimit() }));
  }
  if (!process.env.RENDER_API_KEY || !process.env.JUDGE_WORKFLOW_SLUG) return;
  if (process.env.DISPATCHER === 'off') return;
  startDispatcher(db(), undefined, budgetsFromEnv());
  console.log(JSON.stringify({ msg: 'dispatcher started', ...budgetsFromEnv() }));
}
