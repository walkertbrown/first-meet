import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: () => { throw new Error('no db in unit tests'); }, hasDb: () => false }));

describe("the demo's made-up history (5.36) and the attempt card's because line (5.25 step 1)", () => {
  it('names the made-up cap and the day, five days back, Eastern, for each lift', async () => {
    const { demoBecause, demoCapDate } = await import('../../web/lib/demo');
    const now = new Date('2026-11-08T15:00:00Z');
    expect(demoCapDate(now)).toBe('Nov 3');
    expect(demoBecause('barbell', 'squat', 'lb', now)).toBe("You squatted 115 for 3 with white lights on Nov 3. This one is lighter, so it's already yours.");
    expect(demoBecause('barbell', 'bench', 'lb', now)).toBe("You benched 75 for 3 with white lights on Nov 3. This one is lighter, so it's already yours.");
    expect(demoBecause('barbell', 'deadlift', 'lb', now)).toBe("You deadlifted 135 for 3 with white lights on Nov 3. This one is lighter, so it's already yours.");
    expect(demoBecause('home', 'squat', 'lb', now)).toBe("You did 12 at 25 lb with white lights on Nov 3. This one is fewer, so it's already yours.");
    expect(demoBecause('home', 'bench', 'lb', now)).toBe("You did 12 at 15 lb with white lights on Nov 3. This one is fewer, so it's already yours.");
  });

  it('gives the openers 5.36 names: 100, 65 and 120 lb Barbell; 10 reps Home at 25, 15 and 20', async () => {
    const { demoOpener } = await import('../../web/lib/demo');
    expect(['squat', 'bench', 'deadlift'].map(l => demoOpener('barbell', l as 'squat').weight)).toEqual([100, 65, 120]);
    expect(['squat', 'bench', 'deadlift'].map(l => demoOpener('home', l as 'squat'))).toEqual([
      { weight: 25, reps: 10 }, { weight: 15, reps: 10 }, { weight: 20, reps: 10 }]);
  });

  it('a lift without its own clips uses the squat good clip; the squat cycles its own', async () => {
    const { demoSamplesFor, DEMO_SAMPLES } = await import('../../web/lib/demo');
    expect(demoSamplesFor('squat')).toEqual(DEMO_SAMPLES);
    for (const l of ['bench', 'deadlift'] as const) {
      const c = demoSamplesFor(l);
      expect(c.length).toBeGreaterThan(0);
      expect(c.every(x => x.kind === 'good' && (x.meet!.lift === l || x.meet!.lift === 'squat'))).toBe(true);
    }
  });
});
