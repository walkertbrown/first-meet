// The Barbell bench's stage (plan 3.4b, look 4a and 5.14c): the pieces that only show in a browser, checked in
// the source. The tracker and commands are in bar-stage.test.ts and meet-lift.test.ts; the drawn numbers are in
// bar-marks.test.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAND_QUERY } from '../../web/lib/stage/land';

const src = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');
const css = src('web/app/try.css');
const meet = src('web/components/meet-attempt.tsx');

describe('look 4a: a phone on its side', () => {
  it('is wider than tall and under 600 px tall, so a desktop window keeps the portrait stage', () => {
    expect(LAND_QUERY).toBe('(orientation: landscape) and (max-height: 599px)');
  });
  it('every stage takes the land layout', () => {
    for (const f of ['meet-attempt', 'try-lift', 'spot-check']) {
      const s = src(`web/components/${f}.tsx`);
      // the meet stage is also land when it draws the turn itself (look 4b, rotation lock on)
      expect(s, f).toContain(f === 'meet-attempt' ? 'const landScreen = useLand();' : 'const land = useLand();');
      expect(s, f).toContain("${land ? ' land' : ''}");
      if (f === 'meet-attempt') expect(s).toContain('const land = landScreen || drawn !== 0;');
    }
  });
  it('the panel is a 340 px right column with a 56 px primary; the lamps are 56 px, 20 px apart, 16 px under the top', () => {
    expect(css).toContain('.try-app.land .try-stagecol { flex-direction: row; }');
    expect(css).toMatch(/\.try-app\.land \.try-stagecol \.panel \{ width: 340px;/);
    expect(css).toContain('.try-app.land .panel-in .btn { min-height: 56px; }');
    expect(css).toContain('.try-app.land .stage .lamps { top: calc(16px + var(--sa-t)); gap: 20px; }');
    expect(css).toContain('.try-app.land .stage .lamp { width: 56px; height: 56px; }');
    expect(css).toContain('.try-app.land .waitline { top: 88px; }');
  });
  it('the lamps never land on words (item 91): the HUD\'s words fade as they come in, the close stays', () => {
    expect(css).toContain('.try-app.land .stage:is(.judging, .lit, .norep) .hud > :not(.close) { opacity: 0; }');
  });
});

describe('look 5.14c on the meet stage', () => {
  it('the whole camera view is the tap target, and the mark is four corner brackets, never a ring', () => {
    expect(meet).toContain('className="tap-target"');
    expect(meet).toContain('<i /><i /><i /><i />');
    expect(css).toMatch(/\.tap-target \{[^}]*inset: 0/);
  });
  it('her clip holds with the path dashed 6/5 at 2.5 px in --stage-ink-2 and a 2 x 12 px "Press!" tick, never red', () => {
    const svg = meet.slice(meet.indexOf('className="marks bench-path"'), meet.indexOf('</svg>', meet.indexOf('className="marks bench-path"')));
    expect(svg).toContain('strokeWidth={2.5 / k} strokeDasharray={`${6 / k} ${5 / k}`}');
    expect(svg).toContain('stroke="var(--stage-ink-2)" strokeWidth={2 / k}');
    expect(svg).toContain('- 6 / k');
    expect(svg).not.toMatch(/red/i);
  });
  it('the void: the stage dims to 38% with no lamps, and the sheet is the panel\'s column', () => {
    expect(css).toMatch(/\.stage\.voided \.dim \{[^}]*opacity: \.38/);
    expect(css).toContain('.stage.voided .lamps { opacity: 0; }');
    expect(meet).toContain('void-sheet');
  });
  it('a bench that had its "Start!" always goes to a referee, even when the bar was never seen back up', () => {
    expect(meet).toContain('if ((noRep && !ml.byBar) || !blob || !liftAt) {');
  });
});
