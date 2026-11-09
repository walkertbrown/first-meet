// The HMAC on /api/internal/* (plan 2.3, 3.9): sha256 over "<unix seconds>.<body>" with
// JUDGE_CALLBACK_SECRET, in x-fm-time and x-fm-signature (worker/main.py's sign()).
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_SKEW_S = 300;

export function signBody(body: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  const ts = String(now);
  return { 'x-fm-time': ts, 'x-fm-signature': createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex') };
}

export function verifyBody(body: string, headers: Headers, secret: string | undefined, now = Math.floor(Date.now() / 1000)): boolean {
  if (!secret) return false;
  const ts = headers.get('x-fm-time') ?? '';
  const sig = headers.get('x-fm-signature') ?? '';
  if (!/^\d{9,11}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(now - Number(ts)) > MAX_SKEW_S) return false;
  const want = createHmac('sha256', secret).update(`${ts}.${body}`).digest();
  return timingSafeEqual(want, Buffer.from(sig, 'hex'));
}

/** Reads and checks a signed internal request; null when it isn't signed right. */
export async function signedJson<T>(req: Request): Promise<T | null> {
  const text = await req.text();
  if (!verifyBody(text, req.headers, process.env.JUDGE_CALLBACK_SECRET)) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}
