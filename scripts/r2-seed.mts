// Seeds the R2 bucket for one environment: the demo's sample lifts (content/samples, at
// samples/<file>, copied by the server into an attempt's key, plan 5.36) and health/ok.txt
// (/healthz reads it). Run with the R2_* settings and R2_PREFIX ('' for production, 'staging/'):
//   R2_PREFIX=staging/ npx tsx scripts/r2-seed.mts
// It skips an object that's already there at the same size.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { R2, keys } from '../web/lib/r2';
import samples from '../content/samples/samples.json';

const r = new R2();
const root = join(import.meta.dirname, '..');
for (const c of samples.clips as { file: string }[]) {
  const path = join(root, 'content/samples', c.file);
  const key = keys.sample(c.file);
  const have = await r.head(key);
  if (have?.bytes === statSync(path).size) { console.log('have', r.full(key)); continue; }
  await r.put(key, readFileSync(path), c.file.endsWith('.webm') ? 'video/webm' : 'video/mp4');
  console.log('put', r.full(key));
}
await r.put(keys.health, 'ok', 'text/plain');
console.log('put', r.full(keys.health));
