// GET /api/live?attempt=<id>: server-sent events for the signed-in lifter (plan 3.9 step 7).
// Each event only says which of her attempts changed; the phone then reads it from
// /api/attempts/:id, so nothing here can show anyone else's lift. On (re)connect the phone
// reads the attempt again, which is how it catches up after a dropped stream.
import { db } from '@/db';
import { attemptState } from '@/lib/attempt-state';
import { isFor, subscribe } from '@/lib/live';
import { sessionFrom } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const s = sessionFrom(req);
  if (!s) return new Response('sign in', { status: 401 });
  const watch = new URL(req.url).searchParams.get('attempt');
  if (watch && (await attemptState(db(), watch, s.lifterId)).status !== 200) return new Response('not your attempt', { status: 403 });
  const enc = new TextEncoder();
  let n = Number(req.headers.get('last-event-id')) || 0;
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(ctl) {
      const send = (text: string) => { try { ctl.enqueue(enc.encode(text)); } catch { stop(); } };
      send('retry: 3000\n\n');
      const unsub = subscribe(db(), e => {
        // item 80: a cheer for her says only that one landed; the phone reads them from /api/meet/cheers
        if (e.kind === 'cheer') {
          if (e.lifter_id === s.lifterId) send(`id: ${++n}\nevent: cheer\ndata: {}\n\n`);
          return;
        }
        if (!isFor(e, s.lifterId, watch) || e.kind !== 'attempt') return;
        send(`id: ${++n}\nevent: attempt\ndata: ${JSON.stringify({ attempt_id: e.attempt_id, status: e.status })}\n\n`);
      });
      // a comment every 20 s keeps proxies from closing a quiet stream
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
