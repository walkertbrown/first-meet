// Items 85–87 without a database: the meet window's total, words and refusals; the phone's clock
// sample; "You totaled"'s opening; and the judges' wait arithmetic.
import { describe, expect, it } from 'vitest';
import { meetTotal, ORDER, type MeetAttempt } from '../../web/lib/meet';
import { clipDeadline, meetClosed, notJudgedLabel, notJudgedLine, pastDeadline, windowRefusal } from '../../web/lib/meet-window';
import { clockSample } from '../../web/lib/stage/server-clock';
import { openingShow } from '../../web/components/total-figures';
import { estimateMinutes } from '../../web/lib/attempt-state';
import { judgingClipBody, lateLine, MEET_WORDS, waitingClipBody, WINDOW_WORDS, windowTime } from '../../web/lib/stage/meet-words';

const at = (lift: string, number: number, o: Partial<MeetAttempt> = {}): MeetAttempt =>
  ({ lift: lift as MeetAttempt['lift'], number, weight: 100 + number * 10, repsDeclared: null, status: 'judged', call: 'white', recordedAt: null, ...o });
const nine = (o: (s: { lift: string; number: number }) => Partial<MeetAttempt> = () => ({})) => ORDER.map(s => at(s.lift, s.number, o(s)));

describe('the total after the close (item 85)', () => {
  it('before the close, a missing slot means she is still lifting', () => {
    expect(meetTotal(nine().slice(0, 8), 'barbell').kind).toBe('lifting');
  });
  it('after the close it counts the judged lifts; a void attempt is simply not judged', () => {
    const list = nine(s => (s.number === 3 ? { status: 'void', call: null } : {}));
    const t = meetTotal(list, 'barbell', true);
    expect(t).toMatchObject({ kind: 'total', value: 3 * 120 });
  });
  it('a slot she never lifted does not hold it', () => {
    const t = meetTotal(nine().filter(a => a.number < 3), 'barbell', true);
    expect(t).toMatchObject({ kind: 'total', value: 360 });
  });
  it('no judged good lift in a lift is a bomb out, unless a clip of that lift is still on its way', () => {
    const reds = nine(s => (s.lift === 'bench' ? { call: 'red' } : {}));
    expect(meetTotal(reds, 'barbell', true)).toEqual({ kind: 'bombed', lift: 'bench' });
    const sending = reds.map(a => (a.lift === 'bench' && a.number === 3 ? { ...a, status: 'uploading', call: null } : a));
    expect(meetTotal(sending, 'barbell', true)).toMatchObject({ kind: 'waiting_clip', on: { lift: 'bench', number: 3 } });
  });
  it('"Waiting on your clip" first, then "Waiting on the judges", then a referee; in lift order', () => {
    const list = nine(s => (s.lift === 'squat' && s.number === 3 ? { status: 'queued', call: null }
      : s.lift === 'deadlift' && s.number === 3 ? { status: 'uploading', call: null }
      : s.lift === 'bench' && s.number === 3 ? { status: 'close_call', call: 'close' } : {}));
    expect(meetTotal(list, 'barbell', true)).toMatchObject({ kind: 'waiting_clip', on: { lift: 'deadlift', number: 3, status: 'uploading' } });
    const judging = list.map(a => (a.status === 'uploading' ? { ...a, status: 'judging' } : a));
    expect(meetTotal(judging, 'barbell', true)).toMatchObject({ kind: 'waiting_clip', on: { lift: 'squat', number: 3, status: 'queued' } });
    const referee = judging.map(a => (a.status === 'queued' || a.status === 'judging' ? { ...a, status: 'judged', call: 'white' as const } : a));
    expect(meetTotal(referee, 'barbell', true)).toMatchObject({ kind: 'waiting', on: { lift: 'bench', number: 3 } });
  });
  it('before the close, a held clip is still "lifting" (the platform shows it)', () => {
    const list = nine(s => (s.number === 3 && s.lift === 'deadlift' ? { status: 'uploading', call: null } : {}));
    expect(meetTotal(list, 'barbell').kind).toBe('lifting');
  });
});

describe('the meet window', () => {
  const closesAt = new Date('2027-02-27T23:00:00Z');
  const real = { kind: 'real' as const, closesAt, clipDeadlineAt: null };
  it('closes at closes_at; clips until 6 h later, or the meet\'s own deadline; the demo never closes', () => {
    expect(clipDeadline(real)!.toISOString()).toBe('2027-02-28T05:00:00.000Z');
    expect(clipDeadline({ ...real, clipDeadlineAt: new Date('2027-02-28T01:00:00Z') })!.toISOString()).toBe('2027-02-28T01:00:00.000Z');
    expect(clipDeadline({ ...real, kind: 'demo' })).toBeNull();
    expect(meetClosed(real, new Date(closesAt.getTime() - 1))).toBe(false);
    expect(meetClosed(real, closesAt)).toBe(true);
    expect(pastDeadline(real, new Date('2027-02-28T05:00:00Z'))).toBe(false);
    expect(pastDeadline(real, new Date('2027-02-28T05:00:01Z'))).toBe(true);
  });
  it('refuses a lift recorded at or after the close, and any upload step past the deadline', () => {
    const before = new Date(closesAt.getTime() - 1000);
    expect(windowRefusal(real, before, new Date('2027-02-28T01:00:00Z'))).toBeNull();
    expect(windowRefusal(real, closesAt, new Date('2027-02-28T01:00:00Z'))).toBe('after_close');
    expect(windowRefusal(real, before, new Date('2027-02-28T05:00:01Z'))).toBe('upload_late');
    expect(windowRefusal({ ...real, kind: 'demo' }, closesAt, new Date('2030-01-01'))).toBeNull();
  });
  it('words: the sheets, the lists and the row', () => {
    expect(WINDOW_WORDS.closedBody(closesAt.toISOString(), null)).toBe("It closed at 6 pm Eastern, before this lift started, so this one isn't judged. Your judged lifts stand.");
    expect(WINDOW_WORDS.lateBody('2027-02-28T05:00:00Z', null)).toMatch(/^The judges took clips until Sunday 12 am Eastern, and this one didn't reach us in time/);
    expect(windowTime(closesAt.toISOString(), { local: 'America/Los_Angeles' })).toBe('6 pm Eastern (3 pm)');
    expect(notJudgedLine('after_close')).toBe('Not judged · after the close');
    expect(notJudgedLine('upload_late')).toBe('Not judged · sent too late');
    expect(notJudgedLabel('Squat', 3, 'upload_late')).toBe('Squat 3, not judged, sent too late');
    expect(waitingClipBody({ lift: 'squat', number: 3 }, 'barbell', '2027-02-28T05:00:00Z', null)).toMatch(/^Your Squat 3 is still sending from your phone\./);
    expect(lateLine({ lift: 'squat', number: 3 }, 'barbell')).toBe('Your Squat 3 landed after the close, so your total changed.');
  });
  it('"Waiting on the judges": within a minute, about N minutes from 2, and paused with no minutes (items 85, 87)', () => {
    const on = { lift: 'squat', number: 3 };
    expect(judgingClipBody(on, 'barbell')).toBe("Your Squat 3 reached us, and the judges are looking. Your total lands once it's judged, usually within a minute. You don't need to keep First Meet open.");
    expect(judgingClipBody(on, 'barbell', 1)).toMatch(/usually within a minute/);
    expect(judgingClipBody(on, 'barbell', 4)).toMatch(/Your total lands once it's judged, in about 4 minutes\. You don't/);
    expect(judgingClipBody(on, 'barbell', null, true)).toBe("Your Squat 3 reached us and is saved. Judging is paused for a moment, and your total lands once it's back. You don't need to keep First Meet open.");
    expect(MEET_WORDS.paused90).toBe("Judging is paused for a moment. Your lift is saved and will be judged when it's back.");
  });
});

describe('the phone\'s clock (item 86)', () => {
  it('the server\'s Date plus half the round trip, minus the phone\'s clock', () => {
    const date = new Date(1_000_000_000_000).toUTCString();
    expect(clockSample(999_999_000_000, 999_999_000_400, date)).toBe(1_000_000_000_000 + 200 - 999_999_000_400);
  });
  it('no Date, a negative or a slow (over 5 s) round trip: no sample', () => {
    expect(clockSample(0, 100, null)).toBeNull();
    expect(clockSample(100, 0, new Date().toUTCString())).toBeNull();
    expect(clockSample(0, 5_001, new Date().toUTCString())).toBeNull();
    expect(clockSample(0, 100, 'not a date')).toBeNull();
  });
});

describe('"You totaled"\'s opening (look 4, item 85)', () => {
  const late = 'Your Squat 3 landed after the close, so your total changed.';
  it('the first time: the reveal, from 0, with no line', () => {
    expect(openingShow(undefined, 300, late)).toEqual({ from: 0, line: null });
  });
  it('after a bomb out that became a total: the reveal once, with the line', () => {
    expect(openingShow({ v: null }, 300, late)).toEqual({ from: 0, line: late });
  });
  it('the same total: settled, with whatever line it had', () => {
    expect(openingShow({ v: 300, late }, 300, late)).toEqual({ from: null, line: late });
    expect(openingShow({ v: 300 }, 300, late)).toEqual({ from: null, line: null });
  });
  it('a higher total landed while she was away: settled, with the line; nothing counts down', () => {
    expect(openingShow({ v: 280 }, 300, late)).toEqual({ from: null, line: late });
    expect(openingShow({ v: 320 }, 300, late)).toEqual({ from: null, line: null });
  });
});

describe('the judges\' wait (3.9 step 8, item 87)', () => {
  it('never divides by 0, never NaN or Infinity, always a whole number of at least 1', () => {
    expect(estimateMinutes(0, 0, null)).toBe(1);
    expect(estimateMinutes(0, 0, null, 0)).toBe(1);
    expect(estimateMinutes(120, 0, 60)).toBe(3);
    expect(estimateMinutes(120, 0, 60, 0)).toBe(3);
    expect(estimateMinutes(600, 600, 40, 5)).toBe(6);
    expect(estimateMinutes(Number.NaN, 0, null)).toBe(1);
  });
});
