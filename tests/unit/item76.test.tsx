// Item 76 (plan changes after the 1:12 AM yes), built switched off: each part switched off is the
// 1:12 AM copy, and switched on is The Playner's 4:55 AM Nov 9 answers and look 4's "Waiting on a referee".
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/db', () => ({ db: () => { throw new Error('no db in unit tests'); }, hasDb: () => false }));

const at = new Date('2026-11-03T15:00:00Z');
const now = new Date('2026-11-08T15:00:00Z');

describe('item 76: the card at exactly her cap (5.25 step 1)', async () => {
  const { becauseLine } = await import('../../web/lib/platform-view');
  const { demoBecause } = await import('../../web/lib/demo');
  const sq = { cap: 225, judged: true, at, weight: 225, kind: null } as const;
  const home = { cap: 12, judged: true, at, weight: 35, kind: 'pair' } as const;

  it('switched on, at her cap: "the same weight for just one" / "the same number"', () => {
    expect(becauseLine('barbell', 'squat', sq, 'lb', 225, true)).toBe("You squatted 225 for 3 with white lights on Nov 3. This one is the same weight for just one, so it's already yours.");
    expect(becauseLine('barbell', 'bench', { ...sq, cap: 100, weight: 100 }, 'lb', 100, true)).toBe("You benched 100 for 3 with white lights on Nov 3. This one is the same weight for just one, so it's already yours.");
    expect(becauseLine('home', 'deadlift', home, 'lb', 12, true)).toBe("You did 12 at 35 lb with white lights on Nov 3. This one is the same number, so it's already yours.");
    expect(becauseLine('barbell', 'squat', { ...sq, judged: false, at: null }, 'lb', 225, true)).toBe('The same weight as your best logged triple, for just one. Not judged in training yet.');
    expect(becauseLine('home', 'squat', { ...home, judged: false, at: null }, 'lb', 12, true)).toBe('The same as your best logged set. Not judged in training yet.');
  });

  it('switched on, under her cap: still "lighter" / "fewer"', () => {
    expect(becauseLine('barbell', 'squat', sq, 'lb', 205, true)).toMatch(/This one is lighter, so it's already yours\.$/);
    expect(becauseLine('home', 'deadlift', home, 'lb', 10, true)).toMatch(/This one is fewer, so it's already yours\.$/);
    expect(becauseLine('barbell', 'squat', { ...sq, judged: false, at: null }, 'lb', 205, true)).toBe('Lighter than your best logged triple. Not judged in training yet.');
  });

  it('switched off, at her cap: the 1:12 AM words', () => {
    expect(becauseLine('barbell', 'squat', sq, 'lb', 225, false)).toMatch(/This one is lighter, so it's already yours\.$/);
    expect(becauseLine('home', 'deadlift', home, 'lb', 12, false)).toMatch(/This one is fewer, so it's already yours\.$/);
    expect(becauseLine('home', 'squat', { ...home, judged: false, at: null }, 'lb', 12, false)).toBe('Fewer than your best logged set. Not judged in training yet.');
  });

  it("the demo's card says the same at its made-up cap (115 squat; 12 reps)", () => {
    expect(demoBecause('barbell', 'squat', 'lb', now, 115, true)).toBe("You squatted 115 for 3 with white lights on Nov 3. This one is the same weight for just one, so it's already yours.");
    expect(demoBecause('home', 'squat', 'lb', now, 12, true)).toBe("You did 12 at 25 lb with white lights on Nov 3. This one is the same number, so it's already yours.");
    expect(demoBecause('barbell', 'squat', 'lb', now, 100, true)).toMatch(/lighter/);
    expect(demoBecause('barbell', 'squat', 'lb', now, 115, false)).toMatch(/lighter/);
    expect(demoBecause('home', 'squat', 'lb', now, 12, false)).toMatch(/fewer/);
  });
});

describe("item 76: the closed page's next block date (5.24)", async () => {
  const { blockDateWords, easternDay, REAL_MEETS } = await import('../../web/lib/next-block');
  it('writes a block date as "Monday, March 1", the same day wherever the server is', () => {
    expect(blockDateWords('2027-03-01')).toBe('Monday, March 1');
    expect(blockDateWords('2026-12-07')).toBe('Monday, December 7');
  });
  it('reads today in Eastern', () => {
    expect(easternDay(new Date('2027-03-01T03:00:00Z'))).toBe('2027-02-28');
    expect(easternDay(new Date('2027-03-01T06:00:00Z'))).toBe('2027-03-01');
  });
  it('seeds Spring 2027 the same shape as Winter: 12 weeks, Fri 6 am to Sat 6 pm Eastern, live Sat 8 pm', () => {
    const [w, s] = REAL_MEETS;
    for (const m of REAL_MEETS) {
      expect(new Date(`${m.blockStartsOn}T12:00:00Z`).getUTCDay()).toBe(1);
      expect(m.opensAt.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric' })).toBe('Fri 6 AM');
      expect(m.closesAt.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric' })).toBe('Sat 6 PM');
      expect(m.liveAt.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric' })).toBe('Sat 8 PM');
      const weeks = (m.opensAt.getTime() - new Date(`${m.blockStartsOn}T00:00:00Z`).getTime()) / (7 * 864e5);
      expect(Math.floor(weeks)).toBe(Math.floor((w.opensAt.getTime() - new Date(`${w.blockStartsOn}T00:00:00Z`).getTime()) / (7 * 864e5)));
    }
    expect(s.blockStartsOn).toBe('2027-03-01');
    expect(s.opensAt.toISOString().slice(0, 10)).toBe('2027-05-21');
    expect(w.blockStartsOn).toBe('2026-12-07');
  });
});

describe('item 76: "Waiting" on the 9-attempt row (5.27, look 4)', async () => {
  const { NineRow } = await import('../../web/components/platform');
  const { nineRow } = await import('../../web/lib/platform-view');
  const row = nineRow([
    { lift: 'squat', number: 1, status: 'judged', call: 'white' },
    { lift: 'squat', number: 2, status: 'close_call', call: 'close' },
    { lift: 'squat', number: 3, status: 'close_call', call: 'close' },
  ], null);

  it('switched on: the slot holds only the pulsing lamp, "Waiting" sits once under its group, and the slot is read as waiting for a referee', () => {
    const html = renderToStaticMarkup(<NineRow row={row} division="barbell" item76 />);
    expect(html).not.toContain('slot-wait');
    expect(html).toContain('nine wait-below');
    expect(html.match(/grp-wait eyebrow on/g)).toHaveLength(1);
    expect(html.match(/class="grp-wait eyebrow"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Squat 2, waiting for a referee"');
    expect(html).toContain('aria-label="Squat 3, waiting for a referee"');
    expect(html.match(/mini-lamp pulse/g)).toHaveLength(2);
  });

  it('switched off: the 1:12 AM row, "Waiting" in the cell', () => {
    const html = renderToStaticMarkup(<NineRow row={row} division="barbell" item76={false} />);
    expect(html.match(/<span class="slot-wait">Waiting<\/span>/g)).toHaveLength(2);
    expect(html).not.toContain('grp-wait');
    expect(html).toContain('aria-label="Squat 2, Waiting"');
  });

  it('the CSS keeps every slot 34 px with item 76 on and closes the room after the fade', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../../web/app/platform.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.nine\.wait-below \.slot\.waiting \{ flex: 1; \}/);
    expect(css).toMatch(/transition: opacity 200ms linear, height 260ms var\(--ease-out\) 200ms/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.nine \.grp > \.grp-wait \{ transition: none; \} \}/);
  });
});
