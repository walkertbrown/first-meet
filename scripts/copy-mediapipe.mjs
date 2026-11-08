// Copies the pinned @mediapipe/tasks-vision bundle and wasm into web/public/models/,
// so the site serves them itself (plan 2.2: never from a CDN).
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@mediapipe/tasks-vision');
if (!existsSync(src)) process.exit(0);
const out = join(root, 'web/public/models');
mkdirSync(join(out, 'wasm'), { recursive: true });
cpSync(join(src, 'wasm'), join(out, 'wasm'), { recursive: true });
cpSync(join(src, 'vision_bundle.mjs'), join(out, 'vision_bundle.mjs'));
