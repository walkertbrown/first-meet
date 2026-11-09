// The R2 client against a stand-in S3 server: R2 refuses a PUT without Content-Length (411),
// which is how the Workflow's poses failed to save on staging.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { R2 } from '../../web/lib/r2';

type Seen = { method: string; url: string; headers: IncomingMessage['headers']; body: string };
const seen: Seen[] = [];
let server: Server;
let endpoint = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      if (req.method === 'PUT' && !req.headers['content-length']) { res.statusCode = 411; return res.end(); }
      res.statusCode = 200;
      res.end();
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

const client = () => new R2({ R2_ENDPOINT: endpoint, R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'b', R2_PREFIX: 'staging/' });

describe('R2 client', () => {
  it('putJson sends Content-Length, the body and a signature', async () => {
    seen.length = 0;
    await client().putJson('poses/a.json', { frames: [1, 2, 3] });
    const req = seen[0];
    expect(req.method).toBe('PUT');
    expect(req.url).toBe('/b/staging/poses/a.json');
    expect(req.headers['content-length']).toBe(String(req.body.length));
    expect(JSON.parse(req.body)).toEqual({ frames: [1, 2, 3] });
    expect(req.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(req.headers['transfer-encoding']).toBeUndefined();
  });

  it('put sends Content-Length for bytes too', async () => {
    seen.length = 0;
    await client().put('health/ok.txt', new TextEncoder().encode('ok'), 'text/plain');
    expect(seen[0].headers['content-length']).toBe('2');
  });
});
