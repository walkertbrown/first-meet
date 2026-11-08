// Copies the sample lifts from content/samples/ into web/public/samples/, so the site
// serves them at /samples/<file> (plan 5.2). content/ is the one copy in the repo;
// web/public/samples/ is made at install, dev and build, and never committed.
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { clips } = JSON.parse(readFileSync(join(root, 'content/samples/samples.json'), 'utf8'));
const out = join(root, 'web/public/samples');
mkdirSync(out, { recursive: true });
for (const c of clips) cpSync(join(root, 'content/samples', c.file), join(out, c.file));
