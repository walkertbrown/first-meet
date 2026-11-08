// The one judge on the saved pose points of the six Commons test clips (plan piece 1).
// tests/judge/judge.spec.ts runs the same check with poses found fresh in Chromium.
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CLIPS_DIR, EXPECTED, checkClip } from '../clips/check';

describe('the one judge on tests/clips (saved poses)', () => {
  for (const [name, e] of EXPECTED) {
    const file = join(CLIPS_DIR, 'poses', `${name}.json`);
    it(name, () => {
      expect(existsSync(file), `${name}.json is measured`).toBe(true);
      checkClip(expect, JSON.parse(readFileSync(file, 'utf8')), e);
    });
  }
});
