// Item 119 (held, ITEM_119=on) on her Clip segment: the line when the clip she sent was made again, where
// LookieBot put it (in the Clip line's place, the visibility line 8 px under it, then the buttons), and the
// new clip loaded at its card's version so a cached old one doesn't play.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { CARD_WORDS } from '@/lib/card/card-words';
import { CardScreen } from '@/components/card-screen';
import { newTotalLine, remakeOn } from '@/lib/card/clip-remake';

const screen = (o: Partial<Parameters<typeof CardScreen>[0]> = {}) => renderToStaticMarkup(
  <CardScreen token="AbCdEfGhIjKlMnOp" name="Diane R." start="Clip" judgesOnly clip={{ ready: true, failed: null, shared: true }} {...o} />);

describe('item 119 on her Clip segment', () => {
  it('the words, as The Playner wrote them', () => {
    expect(CARD_WORDS.newTotal).toBe('Your clip ends on your new total now. Share or save it again to send the new one.');
  });

  it('shows in the Clip line\'s place, above the visibility line and the buttons, only when she sent the old clip', () => {
    const html = screen({ clip: { ready: true, failed: null, shared: true, newTotal: true, version: 'h2' } });
    const line = html.indexOf(`<p class="body clip-new">${CARD_WORDS.newTotal}</p>`);
    expect(line).toBeGreaterThan(html.indexOf('caption honest'));
    expect(line).toBeLessThan(html.indexOf(CARD_WORDS.shared));
    expect(html.indexOf(CARD_WORDS.shared)).toBeLessThan(html.indexOf('>Share</button>'));
    expect(screen()).not.toContain(CARD_WORDS.newTotal);
    // never on the other segments
    for (const start of ['Story', 'Post', 'Print'] as const) {
      expect(screen({ start, clip: { ready: true, failed: null, shared: true, newTotal: true } })).not.toContain(CARD_WORDS.newTotal);
    }
    // her videos already on her card link: no visibility line, the new line alone
    const link = screen({ judgesOnly: false, clip: { ready: true, failed: null, shared: false, newTotal: true } });
    expect(link).toContain(CARD_WORDS.newTotal);
    expect(link).not.toContain('clip-line');
  });

  it('the clip loads at its card\'s version', () => {
    expect(screen({ clip: { ready: true, failed: null, shared: true, version: 'abc_D-1' } })).toContain('src="/api/card/AbCdEfGhIjKlMnOp.mp4?v=abc_D-1"');
    expect(screen()).toContain('src="/api/card/AbCdEfGhIjKlMnOp.mp4"');
  });

  it('look (LookieBot, reading 5): Body in --ink like the visibility line, 12 px under, that line 8 px under it; no motion', () => {
    const html = screen({ clip: { ready: true, failed: null, shared: true, newTotal: true } });
    expect(html).toContain('<p class="body clip-new">');
    expect(html).toContain('<p class="body clip-line"');
    const css = readFileSync('web/app/card.css', 'utf8');
    expect(css).toMatch(/\.card-page \.clip-new \{ margin: 12px auto 0; max-width: 360px; \}/);
    expect(css).toMatch(/\.card-page \.clip-new \+ \.clip-line \{ margin-top: 8px; \}/);
    expect(css).not.toMatch(/clip-new[^}]*(animation|transition)/);
  });

  it('the switch: off until approved/plan.md has item 119', () => {
    expect(remakeOn({})).toBe(false);
    expect(remakeOn({ ITEM_119: 'on' })).toBe(true);
    const sent = { status: 'ready', cardHash: 'new', sentHash: 'old' };
    expect(newTotalLine(sent, true)).toBe(true);
    expect(newTotalLine(sent, false)).toBe(false);
    expect(newTotalLine({ ...sent, sentHash: null }, true)).toBe(false);
    expect(newTotalLine({ ...sent, sentHash: 'new' }, true)).toBe(false);
  });
});
