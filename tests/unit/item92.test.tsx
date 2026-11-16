// Item 92 (1): after the cutoff, "Other hours" is a row that opens (5.23, look 5.9): a details/summary
// row with a CaretRight and "Other hours (n)", and under it a plain list of the folded hours.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/db', () => ({ db: () => { throw new Error('no db in unit tests'); }, hasDb: () => false }));

const STARTS = [
  '2027-02-26T12:00:00Z', '2027-02-26T17:00:00Z', '2027-02-26T23:00:00Z', '2027-02-27T01:00:00Z',
  '2027-02-27T13:00:00Z', '2027-02-27T14:00:00Z', '2027-02-27T16:00:00Z', '2027-02-27T19:00:00Z',
];

describe('item 92: "Other hours" opens (look 5.9)', async () => {
  const { FlightPicker, otherHoursLine } = await import('../../web/components/meet-week');
  const html = renderToStaticMarkup(<FlightPicker counts={[1, 0, 2, 0, 0, 4, 0, 1]} mine={[]} open={false} hour={5} starts={STARTS} />);

  it('is a closed details row: the caret, then "Other hours (7)"', () => {
    expect(otherHoursLine(7)).toBe('Other hours (7)');
    const m = html.match(/<details class="mw-other">\s*<summary>(.*?)<\/summary>/s);
    expect(m, 'a closed <details> with a <summary>').not.toBeNull();
    expect(m![1]).toMatch(/^<svg[^>]*class="mw-caret"/);
    expect(m![1]).toContain('aria-hidden="true"');
    expect(m![1]).toContain('<span class="body mw-other-words">Other hours (7)</span>');
    expect(html).not.toContain('<details class="mw-other" open');
  });

  it('lists the 7 other hours plainly, each with its count, and no checkboxes', () => {
    const list = html.match(/<ul class="mw-other-list">(.*?)<\/ul>/s)![1];
    expect(list.match(/<li>/g)).toHaveLength(7);
    expect(list).not.toContain('input');
    expect(list).toContain('2 of your flight picked this');
    expect(html).toContain("YOUR FLIGHT&#x27;S HOUR");
  });

  it('the row is full width, 48 px, with rules above and below; the caret turns 90° in 200 ms, at once with motion off', () => {
    const css = readFileSync(join(__dirname, '../../web/app/meet-week.css'), 'utf8');
    expect(css).toMatch(/\.mw-other summary \{[^}]*min-height: 48px[^}]*border-top: 1px solid var\(--rule\); border-bottom: 1px solid var\(--rule\);/s);
    // 16 px under the winner: the block's 12 px gap and 4 px
    expect(css).toMatch(/\.mw-block \{[^}]*gap: 12px/);
    expect(css).toMatch(/\.mw-other \{ margin-top: 4px; \}/);
    expect(css).toMatch(/\.mw-caret \{[^}]*transition: transform 200ms var\(--ease-out\)/);
    expect(css).toMatch(/\.mw-other\[open\] \.mw-caret \{ transform: rotate\(90deg\); \}/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.mw-caret \{ transition: none; \} \}/);
  });
});
