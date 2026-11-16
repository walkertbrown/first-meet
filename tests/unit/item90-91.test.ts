// Items 90 and 91 (5.4, 5.28, look 5.14a): the corner page after a close she didn't lift in, the lamps
// never landing on the stand-in words, and the demo's total under "DEMO MEET".
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/db', () => ({ db: () => { throw new Error('no db in unit tests'); }, hasDb: () => false }));
const src = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');

describe('item 90 (1): the corner page after the close, when she lifted none', async () => {
  const { closedTitle, CLOSED_BODY } = await import('../../web/lib/corner-view');
  it('says her meet has closed, with the plan\'s words', () => {
    expect(closedTitle('Dana')).toBe('Dana\'s meet has closed.');
    expect(CLOSED_BODY).toBe('She didn\'t lift this time. Her training still counts, and there\'s another meet in the spring.');
  });
  it('is not LIVE: the First Meet eyebrow and "What is First Meet?", with no row, list or Cheer', () => {
    const page = src('web/app/corner/[token]/page.tsx');
    const block = page.match(/if \(view\.kind === 'closed'\) \{([\s\S]*?)\n {2}\}/)![1];
    expect(block).toContain('{`First Meet · ${view.meetName}`}');
    expect(block).toContain('{CLOSED_BODY}');
    expect(block).toContain('What is First Meet?');
    expect(block).not.toMatch(/Live ·|CornerLive|LightsDown/);
  });
});

describe('item 91 (2): the lamps never land on words (look 5.14a)', () => {
  const css = src('web/app/platform.css');
  it('on a sample standing in, the stand-in line and "Demo lifter · Barbell" fade out over the lamps\' 320 ms', () => {
    expect(src('web/components/meet-attempt.tsx')).toContain("className={`meet-hud-text${isSample && standIn ? ' standing-in' : ''}`}");
    expect(css).toMatch(/\.standing-in \.meet-stand-in, \.standing-in \.meet-hud-who \{ transition: opacity 320ms var\(--ease-out\); \}/);
    // whenever the lamps show: the held breath (judging), lit, and a no rep
    for (const s of ['judging', 'lit', 'norep']) {
      expect(css).toContain(`.stage.${s} .standing-in .meet-stand-in, .stage.${s} .standing-in .meet-hud-who`);
    }
    expect(css).toMatch(/\.stage\.norep \.standing-in \.meet-hud-who \{ opacity: 0; \}/);
    // the lamps' own fade is the same 320 ms, and shows on the same three states
    const stage = src('web/app/stage.css');
    expect(stage).toMatch(/\.stage \.lamps \{[^}]*transition: opacity 320ms var\(--ease-out\)/);
    expect(stage).toContain('.stage.judging .lamps, .stage.lit .lamps, .stage.norep .lamps { opacity: 1; }');
  });
  it('at once with motion off, or when a decided attempt reopens settled', () => {
    expect(css).toContain('.settled-open .standing-in .meet-stand-in, .settled-open .standing-in .meet-hud-who { transition: none; }');
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.standing-in \.meet-stand-in, \.standing-in \.meet-hud-who \{ transition: none; \} \}/);
  });
});

describe('item 91 (3): the total\'s eyebrow is the meet\'s name', () => {
  it('"DEMO MEET" on the demo, as on its nine attempts page; never a fixed "WINTER 2027"', () => {
    const page = src('web/app/platform/total/page.tsx');
    expect(page).toContain('<span className="eyebrow">{m?.name ?? \'Winter 2027\'}</span>');
    expect(page).not.toContain('>WINTER 2027<');
  });
});
