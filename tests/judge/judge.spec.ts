// The one judge in headless Chromium: MediaPipe finds the poses fresh in every
// test clip, the judge calls them, and the calls must be the ones in expected.json
// (plan piece 1). Same check as the unit test, without the saved poses.
import { expect, test } from '@playwright/test';
import { EXPECTED, checkClip } from '../clips/check';
import { openPosePage, findPoses } from './pose-page';
import { SAMPLES, checkSample, checkServerSample, playsInTryALift, runSample } from '../clips/sample-flow';

test.describe.configure({ mode: 'serial' });

for (const [name, e] of EXPECTED) {
  test(`${name}: the calls in expected.json`, async ({ page }) => {
    await openPosePage(page);
    const raw = await findPoses(page, `${name}.webm`);
    checkClip(expect, raw as never, e);
  });
}

// The sample lifts (plan 5.2), as shipped, through the stage's own sample timeline.
for (const s of SAMPLES) {
  test(`sample ${s.id}: judged as ${{ good: 'a good lift', no: 'a no lift', close: "a close call (the server's judge)" }[s.kind]}, trimmed to look 7`, async ({ page }) => {
    await openPosePage(page);
    const raw = await findPoses(page, `/samples/${s.file}`);
    if (playsInTryALift(s)) checkSample(expect, s, runSample(raw as never));
    else checkServerSample(expect, s, raw as never);
  });
}
