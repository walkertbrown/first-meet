// Look 5.13's bench marks on the referee's page (3.4b, 5.33): the plate's path in --stage-ink, broken
// where the bar wasn't seen, a labelled tick for each of Start!, Press! and Rack!, and Press! while
// sinking as a 4 px tick. Never red.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RefereeCall, type RefereeCallProps } from '../../web/components/referee-call';
import type { BarTrack } from '../../web/lib/referee-view';

const bar = (wide: boolean): BarTrack => ({
  w: 1000, h: 1000,
  segs: [[[500, 300], [500, 400], [500, 500]], [[500, 450], [500, 300]]],
  ticks: [
    { cmd: 'start', label: 'START!', x: 500, y: 300, wide: false },
    { cmd: 'press', label: 'PRESS!', x: 500, y: 500, wide },
    { cmd: 'rack', label: 'RACK!', x: 500, y: 300, wide: false },
  ],
});
const props = (b: BarTrack | null): RefereeCallProps => ({
  saveUrl: '/api/referee/x', askUrl: '/api/referee/x', lift: 'bench', division: 'barbell', videoUrl: '/clip.webm',
  track: null, bar: b, judgedFrameMs: null, repLights: null, repsDeclared: null, measured: ['Pause: the bar was still 0.6 s before Press!'],
});

describe('the referee\'s bench marks', () => {
  it('draws each stretch the bar was seen as a dashed line, with three labelled ticks, in --stage-ink', () => {
    const html = renderToStaticMarkup(<RefereeCall {...props(bar(false))} />);
    expect(html.match(/<polyline/g)).toHaveLength(2);
    expect(html).toContain('points="500,300 500,400 500,500"');
    expect(html).toContain('stroke-dasharray="6 5"');
    expect(html).toContain('stroke-width="2.5"');
    for (const l of ['START!', 'PRESS!', 'RACK!']) expect(html).toContain(`>${l}</text>`);
    expect(html).not.toMatch(/lamp-red|var\(--red/);
    expect(html.match(/stroke="var\(--stage-ink\)"/g)!.length).toBe(5);
    // the ticks are 12 px across and 2 px thick
    expect(html).toMatch(/<g data-cmd="press"><line x1="494" y1="500" x2="506" y2="500"[^>]*stroke-width="2"/);
  });
  it('Press! while sinking: the Press! tick is 4 px wide', () => {
    const html = renderToStaticMarkup(<RefereeCall {...props(bar(true))} />);
    expect(html).toMatch(/<g data-cmd="press" data-wide="true"><line[^>]*stroke-width="4"/);
    expect(html).toMatch(/<g data-cmd="start"><line[^>]*stroke-width="2"/);
  });
  it('"Show the judge\'s marks" works with the bar alone; without it, it\'s off', () => {
    expect(renderToStaticMarkup(<RefereeCall {...props(bar(false))} />)).not.toMatch(/type="checkbox"[^>]*disabled/);
    expect(renderToStaticMarkup(<RefereeCall {...props(null)} />)).toMatch(/type="checkbox"[^>]*disabled/);
  });
  it('the labels are in Eyebrow type', () => {
    const css = readFileSync(join(__dirname, '../../web/app/referee.css'), 'utf8');
    expect(css).toMatch(/\.ref-tick-label \{[^}]*font-weight: 700; font-stretch: 88%; letter-spacing: \.09em; text-transform: uppercase;/);
  });
});
