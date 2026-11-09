import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('migrations', () => {
  it('name no schema, so each runs in DB_SCHEMA (npm run db:generate strips "public".)', () => {
    const dir = join(__dirname, '../../web/db/migrations');
    for (const f of readdirSync(dir).filter(f => f.endsWith('.sql'))) expect(readFileSync(join(dir, f), 'utf8')).not.toContain('"public".');
  });
});
