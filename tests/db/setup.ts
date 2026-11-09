// Each test file gets its own Postgres schema, migrated from web/db/migrations/, and drops it after.
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { connect, type Db } from '../../web/db';
import { runMigrations } from '../../scripts/migrate.mjs';
import { meets, lifters, attempts } from '../../web/db/schema';
import type { Store } from '../../web/lib/queue';

export const URL_ = process.env.TEST_DATABASE_URL;

export async function freshDb(max = 20): Promise<{ db: Db; schema: string; drop: () => Promise<void> }> {
  const schema = `t_${randomBytes(4).toString('hex')}`;
  await runMigrations(URL_!, schema);
  const db = connect(URL_!, { schema, max });
  return {
    db, schema,
    drop: async () => {
      await db.$client.end();
      const sql = postgres(URL_!, { max: 1, onnotice: () => {} });
      await sql.unsafe(`drop schema "${schema}" cascade; drop schema if exists "drizzle_${schema}" cascade`);
      await sql.end();
    },
  };
}

/** R2 in memory. */
export class MemStore implements Store {
  objects = new Map<string, unknown>();
  async head(key: string) { return this.objects.has(key) ? { bytes: 1000, type: 'video/webm' } : null; }
  async putJson(key: string, v: unknown) { this.objects.set(key, JSON.parse(JSON.stringify(v))); }
  async getJson<T>(key: string) { return (this.objects.get(key) as T) ?? null; }
  async signedGet(key: string) { return `https://r2.test/${key}?signed`; }
  async copy(from: string, to: string) {
    if (!this.objects.has(from)) throw new Error(`R2 copy 404 ${from}`);
    this.objects.set(to, this.objects.get(from));
  }
}

export async function seed(db: Db, store: MemStore, n: number, lift: 'squat' | 'deadlift' = 'squat') {
  const [meet] = await db.insert(meets).values({ slug: `demo-${randomBytes(3).toString('hex')}`, name: 'Demo meet', kind: 'demo', status: 'open' }).returning();
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const [l] = await db.insert(lifters).values({ cardName: `Lifter ${i}`, isDemo: true }).returning();
    const [a] = await db.insert(attempts).values({ lifterId: l.id, meetId: meet.id, lift, number: 1, weight: 100, status: 'uploading', videoKey: `meet/x/${l.id}/${i}.webm` }).returning();
    store.objects.set(a.videoKey!, 'video');
    out.push(a.id);
  }
  return { meet, attempts: out };
}
