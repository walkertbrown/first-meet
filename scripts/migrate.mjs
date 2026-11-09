// Runs web/db/migrations/ on DATABASE_URL, in DB_SCHEMA (default "public"), before the
// web service starts (Render's free web services have no pre-deploy step).
// Without DATABASE_URL it does nothing, so a build with no database still starts.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';

export async function runMigrations(url, schema = 'public') {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`bad DB_SCHEMA: ${schema}`);
  const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { search_path: schema } });
  try {
    await sql.unsafe(`create schema if not exists "${schema}"`);
    await migrate(drizzle(sql), {
      migrationsFolder: fileURLToPath(new URL('../web/db/migrations', import.meta.url)),
      migrationsSchema: schema === 'public' ? 'drizzle' : `drizzle_${schema}`,
    });
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ msg: 'migrate: no DATABASE_URL, skipped' }));
  } else {
    const t0 = Date.now();
    await runMigrations(url, process.env.DB_SCHEMA || 'public');
    console.log(JSON.stringify({ msg: 'migrate: done', schema: process.env.DB_SCHEMA || 'public', ms: Date.now() - t0 }));
  }
}
