// A meet attempt's words (5.25 step 9, 3.5, the Barbell loading line).
import { describe, expect, it } from 'vitest';
import { COMMAND_TEXT, barLoading, meetResult, MEET_WORDS, noRepLine, setupLine, spotLineShown } from '../../web/lib/stage/meet-words';
import { estimateMinutes } from '../../web/lib/attempt-state';
import { isFor } from '../../web/lib/live';

const a = (o: Partial<Parameters<typeof meetResult>[0]>) => ({ call: null, lights: null, reason: null, red_rep: null, reps_declared: null, ...o });

describe('meet words', () => {
  it('white, red with the meet\'s depth sentence, close call', () => {
    expect(meetResult(a({ call: 'white' }))).toMatchObject({ title: 'Good lift', body: 'Your hips went below your knees and you stood tall. A referee would pass that.', lamps: ['white', 'white', 'white'] });
    const red = meetResult(a({ call: 'red', reason: 'depth' }))!;
    expect(red.reason).toEqual({ eyebrow: 'DEPTH', text: 'Almost. Your hips stopped just above your knees. Sit back a little further and take it again.' });
    expect(red.body).toBe('Red lights happen to everyone, even world champions. Most women take it again.');
    expect(meetResult(a({ call: 'close' }))).toMatchObject({ title: 'Close call', lamps: ['off', 'off', 'off'] });
    expect(meetResult(a({}))).toBeNull();
  });

  it('a referee\'s 2–1, both ways', () => {
    expect(meetResult(a({ call: 'white', lights: ['white', 'red', 'white'] }))!.small).toBe('Two white lights and one red. Two whites is a good lift.');
    expect(meetResult(a({ call: 'red', reason: 'no_lockout', lights: ['red', 'white', 'red'] }))).toMatchObject({ small: 'One white light and two red.', lamps: ['red', 'white', 'red'] });
  });

  it('Home: the set as declared, and the red rep named', () => {
    expect(meetResult(a({ call: 'white', reps_declared: 10 }))!.body).toBe('All 10 reps counted. A referee would pass that.');
    expect(meetResult(a({ call: 'white', reps_declared: 8, lift: 'bench' }))!.body).toBe("Your arms pressed up overhead, nearly straight, and you held them there. That's a good lift at First Meet.");
    expect(meetResult(a({ call: 'red', reason: 'depth', reps_declared: 10, red_rep: 6 }))!.reason!.eyebrow).toBe('REP 6 · DEPTH');
  });

  it('the loading line', () => {
    expect(barLoading(100)).toBe('45 lb bar + a green 25 and a 2½ on each side');
    expect(barLoading(185)).toBe('45 lb bar + a blue 45 and a green 25 on each side');
    expect(barLoading(75)).toBe('45 lb bar + a white 10 and a 5 on each side');
    expect(barLoading(405)).toBe('45 lb bar + a blue 45, a blue 45, a blue 45 and a blue 45 on each side');
    expect(barLoading(415)).toMatch(/^45 lb bar \+ a red 55/);
    expect(barLoading(45)).toBe('45 lb bar');
    expect(barLoading(60, 'kg')).toBe('20 kg bar + a blue 20 on each side');
  });

  it('the 90 s line', () => {
    expect(MEET_WORDS.busy90(3)).toBe('Busy platform. Your lights in about 3 minutes.');
  });
});

describe('the wait estimate (3.9 step 8)', () => {
  it('clip seconds ahead ÷ clip seconds finished a minute, + the median pose time, rounded up', () => {
    // 300 s ahead, 150 s finished in 5 min (30 s/min) → 10 min, + 45 s → 10.75 → 11
    expect(estimateMinutes(300, 150, 45)).toBe(11);
    expect(estimateMinutes(0, 0, null)).toBe(1);
    expect(estimateMinutes(120, 0, 60)).toBe(3);
  });
});

describe('live events reach only their lifter', () => {
  const ev = { kind: 'attempt' as const, attempt_id: 'a1', lifter_id: 'L1', status: 'judged' };
  it('her own, or the attempt she watches', () => {
    expect(isFor(ev, 'L1', null)).toBe(true);
    expect(isFor(ev, 'L2', 'a1')).toBe(false);
    expect(isFor({ kind: 'attempt', attempt_id: 'a1', status: 'changed' } as never, 'L2', 'a1')).toBe(true);
    expect(isFor({ kind: 'attempt', attempt_id: 'a1', status: 'changed' } as never, 'L2', 'a2')).toBe(false);
    expect(isFor({ kind: 'close_calls', attempt_id: 'a1' }, 'L1', 'a1')).toBe(false);
  });
});

describe('the attempt card pieces', () => {
  it('splits the plates per side, biggest first', async () => {
    const { platesPerSide, barOf } = await import('../../web/lib/stage/meet-words');
    expect(platesPerSide(100)).toEqual([25, 2.5]);
    expect(platesPerSide(45)).toEqual([]);
    expect(platesPerSide(415)).toEqual([55, 55, 55, 10, 10]);
    expect(platesPerSide(405)).toEqual([45, 45, 45, 45]);
    expect(platesPerSide(60, 'kg')).toEqual([20]);
    expect(barOf('lb')).toBe(45);
    expect(barOf('kg')).toBe(20);
  });
  it('says the HUD line and the sample reps line', async () => {
    const { hudLine, sampleRepsLine, loadingLine } = await import('../../web/lib/stage/meet-words');
    expect(hudLine('Demo lifter', null, 'barbell')).toBe('Demo lifter · Barbell');
    expect(hudLine('June', '60–64', 'home')).toBe('June · 60–64 · Home');
    expect(sampleRepsLine(1)).toBe("This sample is one rep, so it's judged as one.");
    expect(sampleRepsLine(3)).toBe("This sample is 3 reps, so it's judged as 3.");
    expect(loadingLine('home', 25)).toBe('One 25 lb dumbbell');
  });
});

describe('Weight XL and the refused sheet', () => {
  it('a decimal point counts .35 of a digit (look 5.6 row 2)', async () => {
    const { weightDigits } = await import('../../web/lib/stage/meet-words');
    expect(weightDigits(135)).toBe(3);
    expect(weightDigits(95)).toBe(2);
    expect(weightDigits(62.5)).toBeCloseTo(3.35);
    expect(weightDigits(10)).toBe(2);
  });
  it('the refused sheet says the attempt is still hers (3.11)', async () => {
    const { REFUSED_WORDS } = await import('../../web/lib/stage/meet-words');
    expect(REFUSED_WORDS).toEqual({ title: "Your clip didn't send", body: "Nothing was judged, so this attempt is still yours. Lift it again when you're ready." });
  });
  it('a no-rep names her lift, and the commands are the plan\'s words', () => {
    expect(noRepLine('squat', 'barbell')).toBe("We didn't see a squat. Try again when you're ready.");
    expect(noRepLine('bench', 'home')).toBe("We didn't see an overhead press. Try again when you're ready.");
    expect(noRepLine('squat', 'home')).toBe("We didn't see a goblet squat. Try again when you're ready.");
    expect(Object.values(COMMAND_TEXT)).toEqual(['SQUAT!', 'START!', 'PRESS!', 'RACK!', 'DOWN!']);
  });
});

describe("the set-up line at Find your spot (5.25 step 3, item 89)", () => {
  it('only the Home overhead press and the Barbell bench have one, in the plan words', () => {
    expect(setupLine('bench', 'home')).toBe('Face the phone, with room above your head.');
    expect(setupLine('bench', 'barbell')).toBe('Turn your phone on its side on the floor, level with the bench, against a mug or a shoe.');
    for (const d of ['barbell', 'home'] as const) {
      expect(setupLine('squat', d)).toBeNull();
      expect(setupLine('deadlift', d)).toBeNull();
    }
  });
  it('shows until the frame check sees her, then gives way to its lines and does not come back', () => {
    const setup = setupLine('bench', 'home');
    const frames: [boolean, string | null][] = [
      [false, 'Step back until we can see your feet.'], // nobody in frame yet: she is placing the phone
      [false, 'Step back until we can see your feet.'],
      [true, 'Turn to face the phone.'], // seen: the frame check speaks on this frame
      [false, 'Step back until we can see your feet.'], // she steps out: the frame check's line, not the set-up line
      [true, null], // the spot is right
    ];
    let seen = false;
    const shown = frames.map(([p, l]) => { seen ||= p; return spotLineShown(setup, seen, l); });
    expect(shown).toEqual([setup, setup, 'Turn to face the phone.', 'Step back until we can see your feet.', null]);
  });
  it('a lift with no set-up line shows the frame check line from the first frame', () => {
    expect(spotLineShown(null, false, 'Step back until we can see your feet.')).toBe('Step back until we can see your feet.');
  });
});
