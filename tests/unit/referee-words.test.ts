// Who gives the lights, in her words (plan item 88; 3.4d step 14, item 103): "a referee" while
// REFEREE_BOT is off, "the referee bot" once it's on, on every screen that says it.
import { describe, expect, it } from 'vitest';
import { lampsLabel } from '@/components/lamps';
import { botOn, refereeWords, UNAVAILABLE_SMALL } from '@/lib/referee/words';
import { meetResult } from '@/lib/stage/meet-words';
import { waitingBody } from '@/lib/total-view';

const a = (o: Partial<Parameters<typeof meetResult>[0]>) => ({ call: null, lights: null, reason: null, red_rep: null, reps_declared: null, ...o });

describe('the switch', () => {
  it('is on only for REFEREE_BOT=on', () => {
    expect(botOn({ REFEREE_BOT: 'on' })).toBe(true);
    expect(botOn({})).toBe(false);
    expect(botOn({ REFEREE_BOT: 'off' })).toBe(false);
  });
});

describe('the bot on: the plan\'s words', () => {
  it('a close call (5.25 step 9, 3.12)', () => {
    expect(meetResult(a({ call: 'close', reason: 'depth' }), true)).toEqual({
      title: 'Close call',
      body: 'The referee bot is looking at this one, usually within a few minutes. You can take your next attempt while you wait.',
      lamps: ['off', 'off', 'off'],
    });
  });

  it('every Barbell bench (3.4b)', () => {
    expect(meetResult(a({ call: 'close', reason: 'bench_referee', lift: 'bench' }), true)).toEqual({
      title: 'To the referee bot',
      bench: true,
      body: 'The referee bot judges every bench from your video, usually within a few minutes. You can take your next attempt while you wait.',
      lamps: ['off', 'off', 'off'],
    });
    expect(refereeWords(true).benchSending).toBe('Sending to the referee bot');
    expect(refereeWords(true).looking).toBe('The referee bot is looking at this one');
  });

  it('waiting on the total (5.28)', () => {
    expect(waitingBody({ lift: 'deadlift', number: 2 }, 'barbell', true))
      .toBe("The referee bot is still looking at Deadlift 2. Your total lands as soon as it's done, usually within a few minutes.");
  });

  it('Try a lift, the FAQ, and the demo\'s link (5.2, 5.1, 5.36)', () => {
    const w = refereeWords(true);
    expect(w.tryClose).toBe('That one was right on the line. In a meet, the referee bot would decide it. Try once more and sit a little deeper.');
    expect(w.faqVideos).toContain('the judge and the referee bot (both computers; still frames go to Anthropic, whose AI the referee bot uses)');
    expect(w.refereeLink).toBe('See how the referee bot called it');
    expect(w.benchRefereeLink).toBe('See how the referee bot called it');
  });

  it('no screen word says "a referee" or "15 minutes" once it\'s on', () => {
    for (const [k, v] of Object.entries(refereeWords(true))) {
      const text = typeof v === 'function' ? v('Squat 1') : v;
      expect(text, k).not.toMatch(/\ba referee\b|15 minutes|referees/i);
    }
    expect(lampsLabel(['pulse', 'pulse', 'pulse'], true)).toBe('Referee lights: waiting for the referee bot');
  });
});

describe('the bot off: a person decides, as now', () => {
  it('keeps the phase 3 words', () => {
    expect(meetResult(a({ call: 'close', reason: 'depth' }))!.body).toMatch(/^A referee is looking at this one, usually within 15 minutes\./);
    expect(meetResult(a({ call: 'close', reason: 'bench_referee', lift: 'bench' }))!.title).toBe('To a referee');
    expect(waitingBody({ lift: 'squat', number: 3 }, 'barbell')).toBe("A referee is still looking at Squat 3. Your total lands as soon as they're done. Usually within 15 minutes.");
    expect(lampsLabel(['pulse', 'pulse', 'pulse'])).toBe('Referee lights: waiting for a referee');
  });
});

describe('a lift the bot couldn\'t look at (3.4d step 7)', () => {
  it('three whites with the honest line, on or off', () => {
    for (const bot of [true, false]) {
      expect(meetResult(a({ call: 'white', lights: ['white', 'white', 'white'], reason: 'referee_unavailable', lift: 'squat' }), bot))
        .toMatchObject({ title: 'Good lift', small: UNAVAILABLE_SMALL, lamps: ['white', 'white', 'white'] });
    }
    expect(UNAVAILABLE_SMALL).toBe("The referee bot couldn't look at this one, so it counts.");
  });
});
