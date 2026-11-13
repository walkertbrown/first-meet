// GET /api/corner/<token>/live: server-sent events for a corner page (plan 3.9 step 7, 5.4). Each
// event only says one of her attempts changed; the page then reads itself again, so nothing here
// shows more than the page does. On (re)connect the page reads itself again, which is how it
// catches up after a dropped stream.
import { eq } from 'drizzle-orm';
import { db, hasDb } from '@/db';
import { lifters } from '@/db/schema';
import { subscribe } from '@/lib/live';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!hasDb() || !/^[A-Za-z0-9_-]{8,64}$/.test(token)) return new Response('no such corner', { status: 404 });
  const [l] = await db().select({ id: lifters.id, deletedAt: lifters.deletedAt }).from(lifters).where(eq(lifters.cornerToken, token));
  if (!l || l.deletedAt) return new Response('no such corner', { status: 404 });
  const enc = new TextEncoder();
  let n = Number(req.headers.get('last-event-id')) || 0;
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(ctl) {
      const send = (text: string) => { try { ctl.enqueue(enc.encode(text)); } catch { stop(); } };
      send('retry: 3000\n\n');
      const unsub = subscribe(db(), e => {
        if (e.kind !== 'attempt' || e.lifter_id !== l.id) return;
        send(`id: ${++n}\nevent: attempt\ndata: ${JSON.stringify({ attempt_id: e.attempt_id })}\n\n`);
      });
      const beat = setInterval(() => send(': still here\n\n'), 20_000);
      stop = () => { clearInterval(beat); unsub(); try { ctl.close(); } catch { /* already closed */ } };
      req.signal.addEventListener('abort', () => stop(), { once: true });
    },
    cancel() { stop(); },
  });
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
}
