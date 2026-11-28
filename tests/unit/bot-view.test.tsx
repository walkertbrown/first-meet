// The referee bot's side on /referee and the demo's bot page (plan 5.33, 5.36, look 5.14d): the
// lamp board's rows and words, the frames strip's 6 frames and their alt text, the queue's times.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BotBoard, lampSpeech } from '../../web/components/bot-board';
import { decidedText, frameAlt, pickFrames, sideOf } from '../../web/lib/referee/bot-view';

const RED_WHITE_WHITE = sideOf(
  { lights: ['red', 'white', 'white'], lampNotes: ['Hip crease stays above the knee at 2.40 s.', 'Deep enough.', 'Not sure, so the benefit of the doubt.'], reason: 'depth' },
  [{ lamp: 'left', light: 'red', reason: 'depth', rep: null, sure: true, note: 'x' }],
  { light_reasons: ['depth', null, null] },
);

describe("the bot's lamps", () => {
  it('reads each lamp from its review, a red keeping its reason card', () => {
    expect(RED_WHITE_WHITE).toEqual({
      state: 'decided', unavailable: false, lamps: [
        { light: 'red', reason: 'depth', rep: null, note: 'Hip crease stays above the knee at 2.40 s.' },
        { light: 'white', reason: null, rep: null, note: 'Deep enough.' },
        { light: 'white', reason: null, rep: null, note: 'Not sure, so the benefit of the doubt.' },
      ],
    });
  });

  it("when it couldn't look: three whites and no notes", () => {
    expect(sideOf({ lights: ['white', 'white', 'white'], lampNotes: null, reason: 'referee_unavailable' }, null, null)).toMatchObject({
      unavailable: true, lamps: [{ light: 'white', note: null }, { light: 'white', note: null }, { light: 'white', note: null }],
    });
  });

  it('screen readers hear "Left: red light, depth. <note>" (look 5.14d)', () => {
    if (RED_WHITE_WHITE.state !== 'decided') throw new Error('decided');
    expect(lampSpeech('Left', RED_WHITE_WHITE.lamps[0])).toBe('Left: red light, depth. Hip crease stays above the knee at 2.40 s.');
    expect(lampSpeech('Head', RED_WHITE_WHITE.lamps[1])).toBe('Head: white light. Deep enough.');
  });
});

describe('the lamp board', () => {
  it('settled on /referee: a list of three rows, lit, with the reason eyebrow and the notes; no robot, badge or score', () => {
    const html = renderToStaticMarkup(<BotBoard attemptId="a" side={RED_WHITE_WHITE} />);
    expect(html.match(/<li /g)).toHaveLength(3);
    expect(html).toContain('lamp bot-lamp red settled');
    expect(html.match(/lamp bot-lamp white settled/g)).toHaveLength(2);
    expect(html).toContain('DEPTH');
    expect(html).toContain('Not sure, so the benefit of the doubt.');
    expect(html).not.toMatch(/\bAI\b|%|confiden|robot|✦/i);
  });

  it('while it decides: dark lamps that pulse, labels only, and the Body line', () => {
    const html = renderToStaticMarkup(<BotBoard attemptId="a" side={{ state: 'deciding' }} play looking="The referee bot is looking at this one." />);
    expect(html.match(/lamp bot-lamp pulse/g)).toHaveLength(3);
    expect(html).toContain('The referee bot is looking at this one.');
    expect(html).not.toContain('bot-looking gone');
    expect(html).not.toContain('bot-note');
  });

  it('the demo page waits to light them (they light 330 ms apart once it opens); unavailable says it counts', () => {
    expect(renderToStaticMarkup(<BotBoard attemptId="a" side={RED_WHITE_WHITE} play />)).not.toContain('bot-lamp red');
    const un = sideOf({ lights: ['white', 'white', 'white'], lampNotes: null, reason: 'referee_unavailable' }, null, null);
    expect(renderToStaticMarkup(<BotBoard attemptId="a" side={un} />)).toContain('The referee bot couldn&#x27;t look at this one, so it counts.');
  });
});

describe('the frames strip', () => {
  const frames = Array.from({ length: 20 }, (_, n) => ({ n, t_ms: 1000 + n * 100, key: `referee/a/${n}.jpg` }));

  it('6 frames in time order around the judged one, which is ringed', () => {
    const f = pickFrames(frames, 2240, { loaded: 200, squat: 1500 });
    expect(f.map(x => x.tMs)).toEqual([2000, 2100, 2200, 2300, 2400, 2500]);
    expect(f.filter(x => x.judged).map(x => x.tMs)).toEqual([2200]);
    expect(frameAlt(f[4])).toBe('Frame at 2.40 s, after Squat!');
  });

  it('at the clip\'s ends it keeps 6, and before any command the alt has only the time', () => {
    expect(pickFrames(frames, 900, null).map(x => x.n)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pickFrames(frames, 99_000, null).map(x => x.n)).toEqual([14, 15, 16, 17, 18, 19]);
    expect(frameAlt({ tMs: 1000, command: null })).toBe('Frame at 1.00 s');
    expect(pickFrames([], 1000, null)).toEqual([]);
  });
});

describe('"Decided"', () => {
  it('a time today, Eastern; the day too before that', () => {
    const now = new Date('2026-11-15T20:00:00Z');
    expect(decidedText(new Date('2026-11-15T19:42:00Z'), now)).toBe('2:42 pm');
    expect(decidedText(new Date('2026-11-14T15:05:00Z'), now)).toBe('Nov 14, 10:05 am');
  });
});
