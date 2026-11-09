// The demo meet's sample lifts (5.36) go through the real server path, so their stored command
// times must give the server's judge the same call the clip shows: a good lift and a no lift.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { checkCommandTimes, judgeAttempt } from '../../web/lib/judge';
import samples from '../../content/samples/samples.json';

const POSES: Record<string, string> = { 'good-lift': 'sample-good-lift', 'no-lift': 'sample-no-lift' };

describe('demo sample lifts', () => {
  for (const c of samples.clips) {
    test(`${c.id}: stored command times judge as ${c.kind}`, () => {
      const raw = JSON.parse(readFileSync(join(__dirname, '../clips/poses', `${POSES[c.id]}.json`), 'utf8'));
      const ct = c.meet.command_times;
      expect(checkCommandTimes(ct, 'squat', Math.round(raw.duration * 1000))).toBeNull();
      const v = judgeAttempt(raw.frames, raw, 'squat', ct);
      expect(v.call.light).toBe(c.kind === 'good' ? 'white' : 'red');
    });
  }
});

describe('the HUD line under "SAMPLE LIFT" on a Home attempt (5.36)', () => {
  test('one rep, and more', async () => {
    const { sampleRepsLine } = await import('../../web/lib/demo');
    expect(sampleRepsLine(1)).toBe("This sample is one rep, so it's judged as one.");
    expect(sampleRepsLine(3)).toBe("This sample is 3 reps, so it's judged as 3.");
  });
  test('every clip says how many reps it has', () => {
    for (const c of samples.clips) expect(c.meet.reps).toBeGreaterThanOrEqual(1);
  });
});
