// drizzle-kit generate, then drops the "public". it writes into foreign keys, so every
// migration runs in whatever schema DB_SCHEMA's search_path names.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

execFileSync('npx', ['drizzle-kit', 'generate', ...process.argv.slice(2)], { stdio: 'inherit' });
const dir = 'web/db/migrations';
for (const f of readdirSync(dir).filter(f => f.endsWith('.sql'))) {
  const p = join(dir, f);
  const s = readFileSync(p, 'utf8');
  if (s.includes('"public".')) writeFileSync(p, s.replaceAll('"public".', ''));
}
