// Migrations are generated from web/db/schema.ts: npx drizzle-kit generate
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './web/db/schema.ts',
  out: './web/db/migrations',
});
