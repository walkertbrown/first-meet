// The database (plan 3.2): one postgres.js pool per server process. Production and staging
// each have their own Postgres (plan 2.1): production on first-meet-db, staging on
// first-meet-db-staging. So the dispatcher's advisory lock and the fm_live channel are never
// shared between them. DB_SCHEMA names the schema ("public" for production, "staging" for
// staging), left from when the two shared one database.
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

export const dbSchema = () => process.env.DB_SCHEMA || 'public';

export function connect(url: string, opts: { schema?: string; max?: number } = {}): Db {
  const client = postgres(url, {
    max: opts.max ?? 10,
    connection: { search_path: opts.schema ?? dbSchema(), application_name: 'first-meet' },
    onnotice: () => {},
  });
  return drizzle(client, { schema }) as Db;
}

const g = globalThis as unknown as { __fmDb?: Db };

/** The process's pool. Throws when DATABASE_URL isn't set. */
export function db(): Db {
  if (!g.__fmDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    g.__fmDb = connect(url);
  }
  return g.__fmDb;
}

export const hasDb = () => !!process.env.DATABASE_URL;
export { schema };
