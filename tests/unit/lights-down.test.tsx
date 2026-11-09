// Look 2 and 5.24: the platform screens and the corner page go Lights down on meet weekend unless
// she picked Day. The page carries a hidden mark; the Lights down tokens apply to a page with it,
// unless the page is Day. The colours themselves are checked in a browser at the handoff.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LightsDown } from '../../web/components/lights-down';

const css = readFileSync('web/app/globals.css', 'utf8');

describe('Lights down on the platform (look 2)', () => {
  it('the mark is hidden and takes no space', () => {
    expect(renderToStaticMarkup(<LightsDown />)).toBe('<i class="lights-down" hidden="" aria-hidden="true"></i>');
  });

  it('the dark tokens apply to a page with the mark, unless it is Day', () => {
    const block = css.match(/:root\[data-theme="dark"\],\s*:root:not\(\[data-theme="light"\]\):has\(\.lights-down\)\s*\{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/color-scheme: dark/);
    expect(block![1]).toMatch(/--chalk: #0E0F14/);
  });

  it('every platform screen and the corner page carry it; Day picked in her settings leaves it off', () => {
    const layout = readFileSync('web/app/platform/layout.tsx', 'utf8');
    expect(layout).toMatch(/\{!day && <LightsDown \/>\}\{children\}/);
    expect(layout).toMatch(/day = l\?\.theme === 'day'/);
    expect(readFileSync('web/app/corner/[token]/page.tsx', 'utf8')).toMatch(/<LightsDown \/>/);
  });
});
