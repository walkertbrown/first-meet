// Phase 4's card pieces (plan 5.30, 5.5, 5.4, look 9, item 99): the lift on the card (and in the clip),
// who can watch the clip, the certificate and its attempt sheet, the screens' words, and June's card.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { meetTotal, ORDER, type MeetAttempt } from '@/lib/meet';
import { cardLiftOf, fileStem, HONEST_LINE } from '@/lib/card/card-view';
import { clipOnCardLink, clipVisibilityLine, CLIP_MAKING, type CardClip } from '@/lib/card/card-data';
import { attemptSheet, CERT, type SheetAttempt } from '@/lib/card/certificate';
import { CARD_WORDS } from '@/lib/card/card-words';
import { Certificate } from '@/components/certificate';
import { CardScreen } from '@/components/card-screen';
import { WatchHerLift } from '@/components/watch-her-lift';
import { juneCardView, juneView, JUNE_CARD } from '@/lib/corner-view';
import { JUNE_CYCLE_S } from '@/lib/june';

const at = (lift: MeetAttempt['lift'], weight: number, extra: Partial<MeetAttempt> = {}): MeetAttempt =>
  ({ lift, number: 3, weight, repsDeclared: null, status: 'judged', call: 'white', recordedAt: null, ...extra });

describe('the lift on her card, and in her clip (3.9 step 6)', () => {
  it('Barbell: the heaviest bar; a tie goes to the later lift', () => {
    expect(cardLiftOf({ squat: at('squat', 135, { id: 's' }), bench: at('bench', 85, { id: 'b' }), deadlift: at('deadlift', 155, { id: 'd' }) }, 'barbell').id).toBe('d');
    expect(cardLiftOf({ squat: at('squat', 185, { id: 's' }), bench: at('bench', 85, { id: 'b' }), deadlift: at('deadlift', 155, { id: 'd' }) }, 'barbell').id).toBe('s');
    expect(cardLiftOf({ squat: at('squat', 155, { id: 's' }), bench: at('bench', 85, { id: 'b' }), deadlift: at('deadlift', 155, { id: 'd' }) }, 'barbell').id).toBe('d');
  });
  it('Home: the set that scored most, not the heaviest weight', () => {
    const best = {
      squat: at('squat', 25, { id: 's', repsDeclared: 12 }),
      bench: at('bench', 30, { id: 'b', repsDeclared: 5 }),
      deadlift: at('deadlift', 20, { id: 'd', repsDeclared: 10 }),
    };
    expect(cardLiftOf(best, 'home').id).toBe('s');
  });
  it('item 101: a tie inside one lift goes to the later attempt too, and the total carries that pick', () => {
    // Home: her second and third deadlifts both score 200 (20 × 10, 25 × 8); her best lift is the third
    const sets: [number, number][] = [[15, 10], [15, 10], [15, 10], [10, 10], [10, 10], [10, 10], [15, 10], [20, 10], [25, 8]];
    const list = ORDER.map((o, k) => at(o.lift, sets[k][0], { id: `a${k}`, number: o.number, repsDeclared: sets[k][1] }));
    const t = meetTotal(list, 'home');
    expect(t.kind === 'total' && t.top.id).toBe('a8');
    // Barbell: the same weight twice in her squat, both good: the later one
    const bar = ORDER.map((o, k) => at(o.lift, [185, 185, 185, 85, 90, 95, 135, 145, 155][k], { id: `b${k}`, number: o.number }));
    const tb = meetTotal(bar, 'barbell');
    expect(tb.kind === 'total' && tb.top.id).toBe('b2');
  });
});

describe('who can watch her card clip (5.5, item 99)', () => {
  const ready: CardClip = { attemptId: 'a', status: 'ready', key: 'clips/a.mp4', sharedAt: null };
  it('on her card link once shared, or when her videos are "Anyone with my card link"; "My flight" alone is not', () => {
    expect(clipOnCardLink('judges', ready)).toBe(false);
    expect(clipOnCardLink('flight', ready)).toBe(false);
    expect(clipOnCardLink('link', ready)).toBe(true);
    expect(clipOnCardLink('judges', { ...ready, sharedAt: new Date() })).toBe(true);
    expect(clipOnCardLink('flight', { ...ready, sharedAt: new Date() })).toBe(true);
  });
  it('never before render_clip has made it', () => {
    expect(clipOnCardLink('link', { ...ready, status: 'rendering' })).toBe(false);
    expect(clipOnCardLink('link', { ...ready, key: null })).toBe(false);
    expect(clipOnCardLink('link', null)).toBe(false);
  });
  it('5.30\'s line: only on "Only the judges", and it changes once she shares', () => {
    expect(clipVisibilityLine('judges', ready)).toBe('Your clip is only for you until you share it. Sharing it makes this clip, and only this clip, public.');
    expect(clipVisibilityLine('judges', { ...ready, sharedAt: new Date() })).toBe('Your clip is on your card link now. Anyone with the link can watch it.');
    expect(clipVisibilityLine('link', ready)).toBeNull();
    expect(clipVisibilityLine('flight', ready)).toBeNull();
    expect(CLIP_MAKING).toBe('Your clip is being made. It takes about a minute.');
  });
});

describe('the certificate (5.30 Print, look 9)', () => {
  const a = (lift: SheetAttempt['lift'], number: number, weight: number, call: SheetAttempt['call'], extra: Partial<SheetAttempt> = {}): SheetAttempt =>
    ({ lift, number, weight, repsDeclared: null, call, ...extra });
  it('all nine attempts, in words; one not judged is a dash; a retaken void counts its retake', () => {
    const sheet = attemptSheet([
      a('squat', 1, 95, 'white'), a('squat', 2, 105, 'red'), a('squat', 3, 110, null, { status: 'void' }), a('squat', 3, 110, 'white'),
      a('bench', 1, 65, 'white'),
      a('deadlift', 1, 135, 'close'),
    ], 'barbell', 'lb');
    expect(sheet.map(r => r.lift)).toEqual(['Squat', 'Bench press', 'Deadlift']);
    expect(sheet[0].cells).toEqual([{ weight: '95 lb', result: 'Good lift' }, { weight: '105 lb', result: 'No lift' }, { weight: '110 lb', result: 'Good lift' }]);
    expect(sheet[1].cells).toEqual([{ weight: '65 lb', result: 'Good lift' }, null, null]);
    expect(sheet[2].cells).toEqual([null, null, null]);
  });
  it('Home: Home\'s lift names and the reps at the weight', () => {
    const sheet = attemptSheet([a('squat', 1, 25, 'white', { repsDeclared: 10 })], 'home', 'lb');
    expect(sheet[0]).toEqual({ lift: 'Goblet squat', cells: [{ weight: '25 lb × 10', result: 'Good lift' }, null, null] });
  });
  it('rings with "white light", the quote, the sheet, the footer and the honest line', () => {
    const html = renderToStaticMarkup(<Certificate c={{
      name: 'Diane R.', meta: '50–59 · Barbell', season: 'WINTER 2027', total: '340', unitLine: 'LB TOTAL', nineForNine: true,
      lifts: [{ lift: 'squat', label: 'SQUAT', value: '115', written: null }, { lift: 'bench', label: 'BENCH PRESS', value: '70', written: null }, { lift: 'deadlift', label: 'DEADLIFT', value: '155', written: null }],
      sheet: attemptSheet([a('squat', 1, 95, 'white')], 'barbell', 'lb'),
    }} />);
    expect(html.match(/>white light</g)).toHaveLength(3);
    for (const t of ['Diane R.', '340', 'LB TOTAL', '9 FOR 9', CERT.quote, CERT.quoteBy, 'Attempt 3', '95 lb', 'Good lift', 'Hosted by Love Soo · @lovesoostrong', HONEST_LINE]) {
      expect(html).toContain(t.replace(/'/g, '&#x27;'));
    }
  });
});

describe('5.30\'s screen, and 5.5\'s card', () => {
  const screen = (o: Partial<Parameters<typeof CardScreen>[0]> = {}) => renderToStaticMarkup(
    <CardScreen token="AbCdEfGhIjKlMnOp" name="Diane R." clip={{ ready: false, failed: null, shared: false }} judgesOnly {...o} />);
  it('item 102: a clip that couldn\'t be made says so in its frame, with "Try again" once, then "We\'ve told the team."', () => {
    const retry = screen({ start: 'Clip', clip: { ready: false, failed: 'retry', shared: false } });
    expect(retry).toContain('Your clip couldn&#x27;t be made.');
    expect(retry).toContain('Your card is ready to share. You can try the clip again.');
    expect(retry).toContain('>Try again</button>');
    expect(retry).not.toContain(CARD_WORDS.making);
    const final = screen({ start: 'Clip', clip: { ready: false, failed: 'final', shared: false } });
    expect(final).toContain('We&#x27;ve told the team.');
    expect(final).not.toContain('Try again');
    expect(screen({ start: 'Clip' })).toContain(CARD_WORDS.making);
  });
  it('the title, the four segments, the buttons, and the honest line under the card', () => {
    const html = screen();
    expect(html).toContain('<h1 class="page-title">Your meet card</h1>');
    for (const s of CARD_WORDS.segments) expect(html).toContain(`value="${s}"`);
    for (const t of ['Share', 'Save to my phone', 'Copy my card link']) expect(html).toContain(`>${t}</button>`);
    expect(html).toContain('/api/card/AbCdEfGhIjKlMnOp.png?f=story');
    expect(html).toContain(HONEST_LINE.replace(/'/g, '&#x27;'));
  });
  it('look 5.15: her Story and Post frames, and her public card, come from the server pulsing, and the pulse is look 5.15\'s', async () => {
    const waits = /<div class="card-frame (story|post) drawing"><img /;
    expect(screen()).toMatch(waits);
    expect(screen({ start: 'Post' })).toMatch(/<div class="card-frame post drawing"><img /);
    expect(renderToStaticMarkup(<WatchHerLift token="AbCdEfGhIjKlMnOp" name="Diane R." clip />)).toMatch(/<div class="card-frame story drawing"><img /);
    expect(screen({ start: 'Clip' })).not.toContain('drawing');
    const css = (await import('node:fs')).readFileSync('web/app/card.css', 'utf8');
    expect(css).toContain('.card-frame.drawing::before { content: \'\'; position: absolute; inset: 0; background: var(--surface-2); animation: card-wait 1.6s var(--ease-in-out) infinite; }');
    expect(css).toContain('@keyframes card-wait { 0%, 100% { opacity: 1; } 50% { opacity: .6; } }');
    expect(css).toContain('.card-frame.drawing[data-drawn]::before { content: none; }');
    expect(css).toContain('.card-frame.drawing { position: relative; background: transparent; }'); // the dark frame doesn't show through the pulse
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.card-frame\.drawing::before \{ animation: none !important; opacity: \.8; \}/);
  });
  it('5.5: the story card; "Watch her lift" only when her clip is on her card link', () => {
    expect(renderToStaticMarkup(<WatchHerLift token="AbCdEfGhIjKlMnOp" name="Diane R." clip={false} />)).not.toContain('Watch her lift');
    const html = renderToStaticMarkup(<WatchHerLift token="AbCdEfGhIjKlMnOp" name="Diane R." clip />);
    expect(html).toContain('Watch her lift');
    expect(html).toContain('/api/card/AbCdEfGhIjKlMnOp.png?f=story');
  });
  it('a saved file\'s name', () => {
    expect(fileStem('Diane R.')).toBe('diane-r');
    expect(fileStem('Zoë  O\'Neil')).toBe('zoe-oneil');
    expect(fileStem('!!!')).toBe('my');
  });
});

describe('June\'s corner page shows her story card once she totals (5.4, 5.36)', () => {
  it('her card is her nine as each demo meet ends', () => {
    const v = juneCardView();
    expect(v).toMatchObject({ name: 'June Okafor', meta: 'Barbell', units: 'lb', unitLine: 'LB TOTAL' });
    const end = juneView(new Date(JUNE_CYCLE_S * 1000 - 1));
    expect(end).toMatchObject({ kind: 'totaled', card: JUNE_CARD });
    expect(end.kind === 'totaled' && end.total).toBe(v!.total);
  });
});
