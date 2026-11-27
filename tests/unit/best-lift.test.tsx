// A bomb-out's best lift (plan 5.28, 3.9 step 6, item 101; look 9 "The bomb-out clip"): the end frame's words,
// its signed link, the Satori end frame, and the page's block in its three states.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { bestLiftView, endFrameOk, endFramePath, playLength, BEST_LIFT_WORDS, END_FRAME_S } from '@/lib/card/best-lift';
import { bestWeightSize, totalFaceWidth } from '@/lib/card/card-image';
import { bestLiftImage } from '@/lib/card/card-png';
import { BestLiftClip } from '@/components/best-lift-clip';

const diane = { cardName: 'Diane R.', ageGroup: '50–59', division: 'barbell' as const, hometown: 'Asbury Park, NJ', units: 'lb' as const };
const june = { cardName: 'June', ageGroup: null, division: 'home' as const, hometown: 'Tulsa, OK', units: 'kg' as const };

describe('the end frame\'s words', () => {
  it('a barbell lift: the HUD\'s lift line, the number, the unit, three white lights', () => {
    const v = bestLiftView(diane, 'Winter 2027', { lift: 'deadlift', number: 2, weight: 155, repsDeclared: null });
    expect(v.meta).toBe('50–59 · Barbell · Asbury Park, NJ');
    expect(v.season).toBe('WINTER 2027');
    expect(v.liftLine).toBe('DEADLIFT · 2 OF 3');
    expect(v.weight).toBe('155');
    expect(v.unitLine).toBe('LB');
    expect(v.label).toBe("Diane R.'s best lift: deadlift, attempt 2, 155 lb, three white lights.");
  });

  it('Home: the reps go with the unit', () => {
    const v = bestLiftView(june, null, { lift: 'squat', number: 3, weight: 12.5, repsDeclared: 8 });
    expect(v.weight).toBe('12.5');
    expect(v.unitLine).toBe('KG × 8 REPS');
    expect(v.label).toMatch(/, attempt 3, 12\.5 kg × 8 reps, three white lights\.$/);
  });

  it('the length reads m:ss', () => {
    expect(playLength(14_200)).toBe('0:14');
    expect(playLength(9_600)).toBe('0:10');
    expect(playLength(61_000)).toBe('1:01');
  });

  it('5.28\'s words: the failed Body has no card in it', () => {
    expect(BEST_LIFT_WORDS.failedBody).toBe('You can try the clip again.');
    expect(BEST_LIFT_WORDS.making).toBe('Your clip is being made. It takes about a minute.');
    expect(BEST_LIFT_WORDS.eyebrow).toBe('YOUR BEST LIFT');
  });
});

describe('the end frame\'s signed link (no card link for a bomb-out)', () => {
  const id = '0b6f1c3e-8a2d-4f5e-9c7b-1a2b3c4d5e6f', secret = 'test-secret', now = 1_795_000_000;
  const parts = (p: string) => { const u = new URL(p, 'https://x'); return [u.searchParams.get('t'), u.searchParams.get('s')] as const; };

  it('works for its attempt for the clip run\'s lease', () => {
    const p = endFramePath(id, secret, now);
    expect(p.startsWith(`/api/internal/end-frame/${id}.png?`)).toBe(true);
    const [t, s] = parts(p);
    expect(endFrameOk(id, t, s, secret, now)).toBe(true);
    expect(endFrameOk(id, t, s, secret, now + END_FRAME_S)).toBe(true);
  });

  it('not once it\'s old, for another attempt, tampered with, or with no secret', () => {
    const [t, s] = parts(endFramePath(id, secret, now));
    expect(endFrameOk(id, t, s, secret, now + END_FRAME_S + 1)).toBe(false);
    expect(endFrameOk(id, t, s, secret, now - 120)).toBe(false);
    expect(endFrameOk(id.replace('0b', '0c'), t, s, secret, now)).toBe(false);
    expect(endFrameOk(id, t, s!.replace(/^./, c => (c === 'a' ? 'b' : 'a')), secret, now)).toBe(false);
    expect(endFrameOk(id, String(now + 1), s, secret, now)).toBe(false);
    expect(endFrameOk(id, t, s, 'other', now)).toBe(false);
    expect(endFrameOk(id, t, s, undefined, now)).toBe(false);
    expect(endFrameOk(id, 'x', 'y', secret, now)).toBe(false);
  });
});

describe('the end frame (Satori, 1080 × 1920)', () => {
  it('the weight stays at its size when it fits, and steps down when it doesn\'t', () => {
    expect(bestWeightSize('155')).toBe(118);
    const s = bestWeightSize('102.5');
    expect(s).toBeLessThanOrEqual(118);
    expect(totalFaceWidth('102.5', s)).toBeLessThanOrEqual(330);
    expect(bestWeightSize('8888.5')).toBeLessThan(s);
  });

  it('renders at the story size', async () => {
    const v = bestLiftView(diane, 'Winter 2027', { lift: 'deadlift', number: 2, weight: 155, repsDeclared: null });
    const b = Buffer.from(await (await bestLiftImage(v)).arrayBuffer());
    expect(b.subarray(1, 4).toString()).toBe('PNG');
    expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([1080, 1920]);
  }, 30_000);
});

describe('"YOUR BEST LIFT" on the bomb-out page', () => {
  const html = (p: Partial<Parameters<typeof BestLiftClip>[0]>) => renderToStaticMarkup(
    <BestLiftClip ready={false} failed={null} length="0:14" label="Diane R.'s best lift: deadlift, attempt 2, 155 lb, three white lights." {...p} />);

  it('being made: the words in the frame, no buttons, no spinner', () => {
    const h = html({});
    expect(h).toContain('YOUR BEST LIFT');
    expect(h).toContain(BEST_LIFT_WORDS.making);
    expect(h).not.toContain('<button');
    expect(h).not.toMatch(/spinner|progress/);
  });

  it('ready: one button plays it, then Share and Save to my phone; it never autoplays', () => {
    const h = html({ ready: true });
    expect(h).toContain('aria-label="Play your best lift"');
    expect(h).toContain('0:14');
    expect(h).toContain('>Share<');
    expect(h).toContain('>Save to my phone<');
    expect(h).toContain('playsInline');
    expect(h).not.toContain('autoPlay');
    expect(h).not.toMatch(/<video[^>]*controls/);
    expect(h).toContain('three white lights.');
  });

  it('couldn\'t be made: the sheet title and "Try again" once, then "We\'ve told the team." with no button', () => {
    const once = html({ failed: 'retry' });
    expect(once).toContain("Your clip couldn&#x27;t be made.");
    expect(once).toContain('You can try the clip again.');
    expect(once).toContain('>Try again<');
    expect(once).not.toContain('>Share<');
    const last = html({ failed: 'final' });
    expect(last).toContain('told the team.');
    expect(last).not.toContain('<button');
  });
});
