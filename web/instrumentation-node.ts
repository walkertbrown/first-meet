// The Node side of instrumentation.ts: the dispatcher's 2-second loop (plan 3.9), when there's a
// database and a Render key. Without them (dev, CI's build) there's nothing to start.
import { db } from '@/db';
import { budgetsFromEnv, startDispatcher } from '@/lib/dispatcher';

export function start() {
  if (!process.env.DATABASE_URL || !process.env.RENDER_API_KEY || !process.env.JUDGE_WORKFLOW_SLUG) return;
  if (process.env.DISPATCHER === 'off') return;
  startDispatcher(db(), undefined, budgetsFromEnv());
  console.log(JSON.stringify({ msg: 'dispatcher started', ...budgetsFromEnv() }));
}
