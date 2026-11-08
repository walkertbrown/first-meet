// GET /healthz: 200 when every part is up, 503 naming the part that isn't (web/lib/health.ts).
import { checkHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const h = await checkHealth({ web: async () => {} }, process.env.NEXT_PUBLIC_COMMIT ?? 'unknown');
  return Response.json(h, { status: h.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
