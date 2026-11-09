import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: () => { throw new Error('no db in unit tests'); }, hasDb: () => false }));

describe("the demo attempt card's because line (5.25 step 1, 5.36)", () => {
  it('names the made-up cap and the day, five days back, Eastern', async () => {
    const { demoBecause, demoCapDate } = await import('../../web/lib/demo');
    const now = new Date('2026-11-08T15:00:00Z');
    expect(demoCapDate(now)).toBe('Nov 3');
    expect(demoBecause('barbell', 'lb', now)).toBe("You squatted 115 for 3 with white lights on Nov 3. This one is lighter, so it's already yours.");
    expect(demoBecause('home', 'lb', now)).toBe("You did 12 at 25 lb with white lights on Nov 3. This one is fewer, so it's already yours.");
  });
});
