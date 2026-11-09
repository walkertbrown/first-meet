// The session cookie (plan 3.1): httpOnly, Secure, SameSite=Lax. A lifter's lasts 90 days; a
// demo lifter's 7 (they're deleted then). Signed with SESSION_SECRET: "<payload>.<hmac>".
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'fm_session';
export type Session = { lifterId: string; kind: 'lifter' | 'demo'; exp: number };
const DAYS = { lifter: 90, demo: 7 } as const;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production' && process.env.CI !== 'true') throw new Error('SESSION_SECRET is not set');
  return 'dev-only-session-secret';
}

const mac = (payload: string, key = secret()) => createHmac('sha256', key).update(payload).digest('base64url');

export function encodeSession(lifterId: string, kind: Session['kind'], now = Date.now(), key?: string) {
  const s: Session = { lifterId, kind, exp: now + DAYS[kind] * 86_400_000 };
  const payload = Buffer.from(JSON.stringify(s)).toString('base64url');
  return { value: `${payload}.${mac(payload, key)}`, maxAge: DAYS[kind] * 86_400 };
}

export function decodeSession(value: string | undefined | null, now = Date.now(), key?: string): Session | null {
  if (!value) return null;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return null;
  const want = Buffer.from(mac(payload, key));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (typeof s.lifterId !== 'string' || !(s.kind in DAYS) || !(s.exp > now)) return null;
    return s;
  } catch { return null; }
}

export function cookieHeader(value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function sessionFrom(req: Request): Session | null {
  const raw = req.headers.get('cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(raw);
  return decodeSession(m?.[1]);
}
