// The sample lifts on their saved poses, through the stage's sample timeline (plan 5.2,
// look 7). tests/judge/judge.spec.ts runs the same check with poses found fresh.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIPS_DIR } from '../clips/check';
import { KIND_CALL, SAMPLES, SAMPLES_DIR, checkSample, runSample } from '../clips/sample-flow';

describe('the sample lifts', () => {
  it('there is a good lift, a no lift and a close call (5.36), each with its file and a credit', () => {
    expect(SAMPLES.filter(s => s.kind === 'good')).toHaveLength(1);
    expect(SAMPLES.filter(s => s.kind === 'no')).toHaveLength(1);
    expect(SAMPLES.filter(s => s.kind === 'close')).toHaveLength(1);
    const sources = readFileSync(join(SAMPLES_DIR, 'SOURCES.md'), 'utf8');
    for (const s of SAMPLES) {
      expect(existsSync(join(SAMPLES_DIR, s.file)), s.file).toBe(true);
      expect(s.credit.length).toBeGreaterThan(0);
      expect(sources, `${s.file} is in SOURCES.md`).toContain(s.file);
    }
  });
  for (const s of SAMPLES) {
    it(`${s.id} (saved poses)`, () => {
      const file = join(CLIPS_DIR, 'poses', `sample-${s.id}.json`);
      expect(existsSync(file), `sample-${s.id}.json is measured`).toBe(true);
      checkSample(expect, s, runSample(JSON.parse(readFileSync(file, 'utf8'))));
    });
    it(`${s.id} on a slow device (a frame every 600 ms): "Squat!", "Rack!" and the same call`, () => {
      const run = runSample(JSON.parse(readFileSync(join(CLIPS_DIR, 'poses', `sample-${s.id}.json`), 'utf8')), 600);
      expect(run.squatCalled).toBe(true);
      expect(run.rackAt, '"Rack!" is called').not.toBeNull();
      expect(run.noRep).toBe(false);
      expect(run.call).toBe(KIND_CALL[s.kind]);
    });
  }
});
