// When the web service starts (Node only): the dispatcher's 2-second loop (plan 3.9), when
// there's a database and a Render key. Without them (dev, CI's build) there's nothing to start.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (!process.env.DATABASE_URL || !process.env.RENDER_API_KEY || !process.env.JUDGE_WORKFLOW_SLUG) return;
  if (process.env.DISPATCHER === 'off') return;
  const { db } = await import('@/db');
  const { startDispatcher, budgetsFromEnv } = await import('@/lib/dispatcher');
  startDispatcher(db(), undefined, budgetsFromEnv());
  console.log(JSON.stringify({ msg: 'dispatcher started', ...budgetsFromEnv() }));
}
