// Writes the pose points for each test clip to tests/clips/poses/<clip>.json.
// Run with EXTRACT=1 npm run test:judge -- extract. The unit tests read these files,
// so the judge's rules can be tested in milliseconds; judge.spec.ts re-finds the poses
// in Chromium every time and must agree.
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, openPosePage, findPoses } from './pose-page';
import { SAMPLES } from '../clips/sample-flow';

test.skip(!process.env.EXTRACT, 'only when EXTRACT=1');
test.setTimeout(40 * 60_000);

test('extract poses for every test clip', async ({ page }) => {
  await openPosePage(page);
  const out = join(ROOT, 'tests/clips/poses');
  mkdirSync(out, { recursive: true });
  // CLIP=half-squat,racked-squats-side measures only those clips (exact names, no .webm)
  const only = process.env.CLIP?.split(',');
  for (const f of readdirSync(join(ROOT, 'tests/clips')).filter(f => f.endsWith('.webm'))) {
    if (only && !only.includes(f.replace('.webm', ''))) continue;
    const r = await findPoses(page, f);
    writeFileSync(join(out, f.replace('.webm', '.json')), JSON.stringify(r));
    console.log(`${f}: ${r.frames.length} frames, ${r.frames.filter(x => x.p).length} with a pose, ${r.secs.toFixed(1)} s for ${r.duration.toFixed(1)} s`);
  }
  // The sample lifts, as shipped, to tests/clips/poses/sample-<id>.json (CLIP=sample-<id>).
  for (const s of SAMPLES) {
    if (only && !only.includes(`sample-${s.id}`)) continue;
    const r = await findPoses(page, `/samples/${s.file}`);
    writeFileSync(join(out, `sample-${s.id}.json`), JSON.stringify(r));
    console.log(`sample ${s.id}: ${r.frames.length} frames, ${r.frames.filter(x => x.p).length} with a pose`);
  }
});
