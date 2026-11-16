// GET /healthz: 200 when every part is up, 503 naming the part that isn't (web/lib/health.ts).
// Parts join as they're configured: the database, R2 (a HEAD of health/ok.txt and each sample lift) and Render's
// Workflow API (cached for 60 s). FAULT=db|r2|judge (staging only) fails that part on purpose (2.1, the uptime test).
import { sql } from 'drizzle-orm';
import { cachedFor, checkHealth, type PartCheck } from '@/lib/health';
import { db, hasDb } from '@/db';
import { hasR2, keys, r2 } from '@/lib/r2';
import { missingSamples } from '@/lib/health';
import { watchNumbers, type Watch } from '@/lib/watch';
import samples from '../../../content/samples/samples.json';

export const dynamic = 'force-dynamic';

const fault = (part: string) => { if (process.env.FAULT === part) throw new Error('FAULT set'); };

// One Workflow API list call a minute at most (2.4), however often the uptime check or a person asks.
const WORKFLOW_CACHE_MS = 60_000;
const workflowApi = cachedFor(WORKFLOW_CACHE_MS, async () => {
  const res = await fetch('https://api.render.com/v1/task-runs?limit=1', {
    headers: { authorization: `Bearer ${process.env.RENDER_API_KEY}`, accept: 'application/json' }, signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Workflow API ${res.status}`);
});

// Every demo sample lift is in this bucket (seeded by scripts/r2-seed.mts for each environment). A missing
// one made "Use a sample lift instead" a bare 500 on production (NerdCider, Nov 15). Checked every 10 minutes.
const SAMPLE_CACHE_MS = 10 * 60_000;
const sampleClips = cachedFor(SAMPLE_CACHE_MS, async () => {
  const gone = await missingSamples(k => r2().head(k), (samples.clips as { file: string }[]).map(c => keys.sample(c.file)));
  if (gone.length) throw new Error(`sample missing: ${gone.join(', ')}`);
});

export async function GET() {
  const parts: Record<string, PartCheck> = { web: async () => {} };
  if (hasDb()) parts.db = async () => { fault('db'); await db().execute(sql`select 1`); };
  if (hasR2()) parts.r2 = async () => { fault('r2'); if (!(await r2().head(keys.health))) throw new Error('health/ok.txt missing'); await sampleClips(); };
  if (process.env.RENDER_API_KEY) parts.judge = async () => { fault('judge'); await workflowApi(); };
  const h = await checkHealth(parts, process.env.NEXT_PUBLIC_COMMIT ?? 'unknown');
  // the uptime check's other two issues (2.4); never part of `ok`, and a failure here leaves them out
  let watch: Watch | null = null;
  if (hasDb()) watch = await watchNumbers(db()).catch(() => null);
  return Response.json({ ...h, watch }, { status: h.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
