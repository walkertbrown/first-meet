import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { signBody, verifyBody } from '../../web/lib/hmac';

const SECRET = 'test-secret';
const now = 1_800_000_000;
const body = JSON.stringify({ worker_id: 'w-1' });
const signed = (b: string, secret: string, ts: number) => new Headers(signBody(b, secret, ts));

describe('worker signatures (HMAC-SHA256 of "<time>.<body>")', () => {
  it('a good signature passes', () => expect(verifyBody(body, signed(body, SECRET, now), SECRET, now)).toBe(true));
  it('a changed body fails', () => expect(verifyBody(body + ' ', signed(body, SECRET, now), SECRET, now)).toBe(false));
  it('the wrong secret fails', () => expect(verifyBody(body, signed(body, 'other', now), SECRET, now)).toBe(false));
  it('more than 5 minutes old fails', () => expect(verifyBody(body, signed(body, SECRET, now - 301), SECRET, now)).toBe(false));
  it('missing headers fail', () => expect(verifyBody(body, new Headers(), SECRET, now)).toBe(false));
  it('no secret set fails', () => expect(verifyBody(body, signed(body, '', now), '', now)).toBe(false));
  it('matches the worker: the same HMAC Python makes', () => {
    const py = execFileSync('python3', ['-I', '-c',
      'import hmac,hashlib,sys; print(hmac.new(sys.argv[1].encode(), (sys.argv[2]+"."+sys.argv[3]).encode(), hashlib.sha256).hexdigest())',
      SECRET, String(now), body]).toString().trim();
    expect(signBody(body, SECRET, now)['x-fm-signature']).toBe(py);
  });
});
