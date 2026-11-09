// The demo's welcome sheet (plan 5.36, look 5.10): "Start the demo meet" lands on the platform with
// it first, in its words, with her corner page in a new tab.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/db', () => ({ db: () => ({}), hasDb: () => true }));
vi.mock('@/lib/demo', () => ({ startDemo: async () => ({ lifter: { id: '00000000-0000-4000-8000-000000000001' } }) }));

describe('the welcome sheet (5.36)', () => {
  it('"Start the demo meet" goes to the platform with the welcome sheet first', async () => {
    process.env.SESSION_SECRET ||= 'test-secret-test-secret-test-secret-00';
    const { POST } = await import('../../web/app/api/demo/start/route');
    const fd = new FormData(); fd.set('card_name', 'June'); fd.set('division', 'barbell');
    const r = await POST(new Request('http://x/api/demo/start', { method: 'POST', body: fd }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/platform?welcome=1');
  });

  it('has 5.36 word for word: the title, both bodies, Primary "Go to the platform", Ghost to her corner page in a new tab', async () => {
    const { WelcomeSheet } = await import('../../web/components/platform');
    const html = renderToStaticMarkup(<WelcomeSheet corner="/corner/abcdefghijklmnop" onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('<h2 class="sheet-title" id="welcome-title">Welcome to the demo meet</h2>');
    expect(html).toContain('You have three attempts at each lift. Your openers are already chosen from a made-up training history, so you can lift right away. No camera, or no weights? Use a sample lift on any attempt.');
    expect(html).toContain('Friends can follow along and cheer on your corner page.');
    expect(html).toMatch(/<button class="btn" type="button">Go to the platform<\/button>/);
    expect(html).toContain('<a class="btn ghost" href="/corner/abcdefghijklmnop" target="_blank" rel="noopener">Open my corner page in a new tab</a>');
  });

  it('item 78 on: "Open my corner page", still a new tab, and screen readers hear that it opens one', async () => {
    const { WelcomeSheet } = await import('../../web/components/platform');
    const html = renderToStaticMarkup(<WelcomeSheet corner="/corner/abcdefghijklmnop" onClose={() => {}} item78 />);
    expect(html).toContain('<a class="btn ghost new-tab" href="/corner/abcdefghijklmnop" target="_blank" rel="noopener" aria-label="Open my corner page, opens in a new tab">Open my corner page<svg');
    // the mark: Phosphor Bold ArrowUpRight, 24 px, hidden from screen readers, after the words
    expect(html).toMatch(/Open my corner page<svg[^>]*width="24"[^>]*height="24"[^>]*aria-hidden="true"/);
    expect(html).not.toContain('in a new tab</a>');
  });
});
