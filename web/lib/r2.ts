// Cloudflare R2, through its S3 API (plan 3.10): meet videos uploaded by the phone in 5 MB
// parts with presigned links, signed GET links that last 10 minutes, and the Workflow's pose
// points at poses/<attempt>.json. Staging keeps everything under R2_PREFIX ("staging/").
import { AwsClient } from 'aws4fetch';

export const PART_BYTES = 5 * 1024 * 1024;
export const GET_LINK_SECONDS = 600;
const PUT_LINK_SECONDS = 3600;

type Env = { R2_ACCOUNT_ID?: string; R2_ACCESS_KEY_ID?: string; R2_SECRET_ACCESS_KEY?: string; R2_BUCKET?: string; R2_PREFIX?: string; R2_ENDPOINT?: string };

export class R2 {
  private aws: AwsClient;
  readonly base: string;
  readonly prefix: string;

  constructor(env: Env = process.env as Env) {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env;
    if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || (!R2_ACCOUNT_ID && !env.R2_ENDPOINT)) throw new Error('R2 settings are missing');
    this.aws = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
    this.base = `${(env.R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/$/, '')}/${R2_BUCKET}`;
    this.prefix = env.R2_PREFIX ?? '';
  }

  /** The object's full key: the environment's prefix, then the key the app uses. */
  full(key: string) { return this.prefix + key; }

  url(key: string, query: Record<string, string> = {}) {
    const u = new URL(`${this.base}/${this.full(key).split('/').map(encodeURIComponent).join('/')}`);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u;
  }

  private async call(method: string, key: string, init: { query?: Record<string, string>; body?: BodyInit; headers?: Record<string, string> } = {}) {
    // Sign, then send the plain body ourselves: aws4fetch's own fetch wraps it in a Request, so
    // Node streams it chunked with no Content-Length, and R2 refuses a PUT like that (411).
    const signed = await this.aws.sign(this.url(key, init.query).toString(), { method, body: init.body, headers: init.headers });
    return fetch(signed.url, { method, headers: signed.headers, body: init.body });
  }

  private async presign(method: string, key: string, seconds: number, query: Record<string, string> = {}) {
    const u = this.url(key, { ...query, 'X-Amz-Expires': String(seconds) });
    const signed = await this.aws.sign(u.toString(), { method, aws: { signQuery: true } });
    return signed.url;
  }

  /** A link anyone can GET for `seconds` (10 minutes by default). */
  signedGet(key: string, seconds = GET_LINK_SECONDS) { return this.presign('GET', key, seconds); }

  /** Size and type, or null when there's no such object. */
  async head(key: string): Promise<{ bytes: number; type: string | null } | null> {
    const res = await this.call('HEAD', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 HEAD ${res.status}`);
    return { bytes: Number(res.headers.get('content-length') ?? 0), type: res.headers.get('content-type') };
  }

  /** Puts bytes at a key (seeding the bucket: the sample lifts, health/ok.txt). */
  async put(key: string, body: BodyInit, type: string) {
    const res = await this.call('PUT', key, { body, headers: { 'content-type': type } });
    if (!res.ok) throw new Error(`R2 PUT ${res.status}`);
  }

  async putJson(key: string, value: unknown) {
    const res = await this.call('PUT', key, { body: JSON.stringify(value), headers: { 'content-type': 'application/json' } });
    if (!res.ok) throw new Error(`R2 PUT ${res.status}`);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const res = await this.call('GET', key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 GET ${res.status}`);
    return (await res.json()) as T;
  }

  /** Server-side copy inside the bucket (the demo's sample lifts, 5.36). Both keys get the prefix. */
  async copy(from: string, to: string) {
    const src = `/${this.base.split('/').pop()}/${this.full(from).split('/').map(encodeURIComponent).join('/')}`;
    const res = await this.call('PUT', to, { headers: { 'x-amz-copy-source': src } });
    if (!res.ok) throw new Error(`R2 copy ${res.status}`);
  }

  async remove(key: string) {
    const res = await this.call('DELETE', key);
    if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${res.status}`);
  }

  // The phone's upload (3.10): the server starts it, signs each part's PUT, and finishes it.

  async startUpload(key: string, type: string): Promise<string> {
    const res = await this.call('POST', key, { query: { uploads: '' }, headers: { 'content-type': type } });
    if (!res.ok) throw new Error(`R2 start upload ${res.status}`);
    const id = /<UploadId>([^<]+)<\/UploadId>/.exec(await res.text())?.[1];
    if (!id) throw new Error('R2 start upload: no UploadId');
    return id;
  }

  signPart(key: string, uploadId: string, part: number) {
    return this.presign('PUT', key, PUT_LINK_SECONDS, { partNumber: String(part), uploadId });
  }

  /** The part numbers R2 already has, with their ETags, so a reloaded phone resumes. */
  async listParts(key: string, uploadId: string): Promise<{ part: number; etag: string; bytes: number }[] | null> {
    const res = await this.call('GET', key, { query: { uploadId } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 list parts ${res.status}`);
    const xml = await res.text();
    return [...xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map(m => ({
      part: Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(m[1])?.[1]),
      etag: (/<ETag>([^<]+)<\/ETag>/.exec(m[1])?.[1] ?? '').replace(/&quot;/g, '"'),
      bytes: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0),
    }));
  }

  async finishUpload(key: string, uploadId: string, parts: { part: number; etag: string }[]) {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const body = `<CompleteMultipartUpload>${[...parts].sort((a, b) => a.part - b.part)
      .map(p => `<Part><PartNumber>${p.part}</PartNumber><ETag>${esc(p.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
    const res = await this.call('POST', key, { query: { uploadId }, body, headers: { 'content-type': 'application/xml' } });
    const text = await res.text();
    if (!res.ok || text.includes('<Error>')) throw new Error(`R2 finish upload ${res.status}`);
  }
}

let shared: R2 | null = null;
export function r2(): R2 {
  shared ??= new R2();
  return shared;
}
export const hasR2 = () => !!(process.env.R2_ACCESS_KEY_ID && process.env.R2_BUCKET);

/** Where things live in the bucket (3.10). */
export const keys = {
  meetVideo: (meet: string, lifter: string, attempt: string, ext: 'webm' | 'mp4') => `meet/${meet}/${lifter}/${attempt}.${ext}`,
  poses: (attempt: string) => `poses/${attempt}.json`,
  firstPass: (attempt: string) => `poses/${attempt}.pass1.json`,
  sample: (file: string) => `samples/${file}`,
  health: 'health/ok.txt',
};

export const extOf = (type: string): 'webm' | 'mp4' | null =>
  /^video\/webm\b/.test(type) ? 'webm' : /^video\/mp4\b/.test(type) ? 'mp4' : null;
