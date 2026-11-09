// Item 81, look 5.6: short screens, and "I'm ready" docks when it can't fit. The geometry is checked
// in a browser at the handoff; here, the markup it needs, the CSS's sizes, and the rule that it is one
// observer and nothing measured on resize or scroll.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { dockMargin, isDocked } from '../../web/components/ready-dock';

const props = {
  attempt: { id: 'a1', lift: 'squat', number: 1, weight: 135, reps_declared: null, status: 'declared' },
  lifter: { division: 'barbell' as const, units: 'lb' as const, cardName: 'Dana', barWeight: 45, homeWeights: [] },
  because: 'Your opener.', voicePack: 'a', onNext: () => {},
  strip: <section className="flight-strip">STRIP</section>,
};
const card = async (item81: boolean, demo = true) => {
  const { MeetAttempt } = await import('../../web/components/meet-attempt');
  return renderToStaticMarkup(<MeetAttempt {...(props as never)} item81={item81} demoReferee={demo} />);
};
const css = readFileSync('web/app/platform.css', 'utf8');
const src = readFileSync('web/components/ready-dock.tsx', 'utf8');

describe('"I\'m ready" docks (look 5.6)', () => {
  it('on: the Primary alone in its sticky wrapper, a direct child of the column; the sentinel straight after; then the links, then the strip', async () => {
    const html = await card(true);
    expect(html).toMatch(/^<div class="try-page meet-page look-56"><main class="try-col meet-col">/);
    expect(html).toMatch(/<\/article><div class="ready-dock"><button class="btn" type="button">I&#x27;m ready<\/button><\/div><i class="ready-sentinel" aria-hidden="true"><\/i><div class="try-actions ready-links"><button class="link" type="button">Use a sample lift instead<\/button><button class="link" type="button">Test your spot first<\/button><\/div><section class="flight-strip">STRIP<\/section><\/main>/);
  });

  it('a real (or the test) meet has no "Use a sample lift instead": the demo meet\'s only (5.36)', async () => {
    for (const on of [true, false]) {
      const html = await card(on, false);
      expect(html).not.toContain('Use a sample lift');
      expect(html).toContain('Test your spot first');
    }
    expect(await card(false, true)).toContain('Use a sample lift instead');
  });

  it('off: the 1:12 AM markup, no dock and no short-screen class', async () => {
    const html = await card(false);
    expect(html).not.toMatch(/ready-dock|ready-sentinel|look-56/);
    expect(html).toMatch(/STRIP<\/section><div class="try-actions"><button class="btn" type="button">I&#x27;m ready/);
  });

  it('docked exactly while the sentinel is below the line B px above the visible bottom', () => {
    expect(dockMargin(16)).toBe('0px 0px -16px 0px');
    expect(dockMargin(50.4)).toBe('0px 0px -50px 0px');
    expect(isDocked({ isIntersecting: false, top: 533, rootBottom: 532 })).toBe(true);
    expect(isDocked({ isIntersecting: true, top: 532, rootBottom: 532 })).toBe(false); // edge to edge: in its place
    expect(isDocked({ isIntersecting: false, top: -40, rootBottom: 532 })).toBe(false); // scrolled past, above
  });

  it('one observer, rebuilt only when the phone turns; nothing on resize or scroll', () => {
    expect(src.match(/new IntersectionObserver/g)).toHaveLength(1);
    expect(src).toMatch(/matchMedia\?\.\('\(orientation: portrait\)'\)/);
    expect(src).not.toMatch(/'resize'|'scroll'|orientationchange|onscroll|onresize/);
  });

  it('the CSS: sticky 16 px plus the safe area; the chalk band from 12 px above to the bottom edge, ruled; no motion', () => {
    expect(css).toMatch(/\.ready-dock \{ position: sticky; z-index: 1; bottom: calc\(16px \+ env\(safe-area-inset-bottom\)\);/);
    expect(css).toMatch(/\.ready-dock\[data-docked\]::before \{[^}]*top: -12px;[^}]*bottom: calc\(-16px - env\(safe-area-inset-bottom\)\); background: var\(--chalk\); border-top: 1px solid var\(--rule\); \}/);
    const dockRules = css.split('\n').filter(l => /ready-/.test(l)).join('\n');
    expect(dockRules).not.toMatch(/transition|animation|box-shadow|blur/);
    expect(css).toMatch(/\.ready-sentinel \{ display: block; height: 1px; margin: -16px 0 -1px;/);
    expect(css).toMatch(/\.look-56 \.ready-links \{ margin-top: -4px;/); // 16 - 4: 12 px under the button
  });
});

describe('short screens (look 5.6): only space and the drawing shrink', () => {
  const short = css.slice(css.indexOf('@media (max-height: 700px) {'));
  const block = short.slice(0, short.indexOf('\n}\n'));
  it('at 700 px tall or less, behind item 81', () => {
    expect(block).toContain('.look-56 .platform-top { margin-bottom: 8px; }');
    expect(block).toContain('.look-56 .nine { margin-top: 12px; }');
    expect(block).toContain('.look-56 .attempt-card { padding: 16px; gap: 8px; margin-bottom: 8px; }');
    expect(block).toContain('.look-56 .ac-because { padding-top: 8px; }');
    expect(block).toContain('.look-56 .attempt-card .bar-diagram { height: 44px; }');
    expect(block).not.toMatch(/font|line-height|--xl/);
    expect(css).toContain('.look-56 .attempt-card { margin-bottom: 24px; }'); // 16 + 24: 40 under the card, as before
  });
});
