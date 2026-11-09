// Meet week's rules (plan 5.23, 3.2): the eight hours in Eastern, her time zone's labels, the
// cutoff, the week-12 window, the tie rule, and the checklist's lines.
import { describe, expect, it } from 'vitest';
import {
  MEET_WEEK_SLOTS, barbellChecklistLine, etWallToUtc, flightWinner, homeChecklistLine, hourSetAt, inMeetWeek,
  pickedLine, slotLabel, slotOf, slotStart, tickedLine, weekTwelveMonday,
} from '../../web/lib/meet-week';

const WINTER = new Date('2027-02-26T11:00:00Z'); // Fri 6 am EST
const SPRING = new Date('2027-05-21T10:00:00Z'); // Fri 6 am EDT

describe('the eight hours (5.23)', () => {
  it('are Eastern wall hours, Friday and Saturday, in winter and summer time', () => {
    expect(MEET_WEEK_SLOTS).toHaveLength(8);
    expect(etWallToUtc('2027-02-26', 7).toISOString()).toBe('2027-02-26T12:00:00.000Z');
    expect(etWallToUtc('2027-05-21', 7).toISOString()).toBe('2027-05-21T11:00:00.000Z');
    expect(MEET_WEEK_SLOTS.map((_, i) => slotStart(WINTER, i).toISOString())).toEqual([
      '2027-02-26T12:00:00.000Z', '2027-02-26T17:00:00.000Z', '2027-02-26T23:00:00.000Z', '2027-02-27T01:00:00.000Z',
      '2027-02-27T13:00:00.000Z', '2027-02-27T14:00:00.000Z', '2027-02-27T16:00:00.000Z', '2027-02-27T19:00:00.000Z',
    ]);
    expect(slotStart(SPRING, 5).toISOString()).toBe('2027-05-22T13:00:00.000Z');
    expect(slotOf(WINTER, new Date('2027-02-27T14:00:00Z'))).toBe(5);
    expect(slotOf(WINTER, null)).toBe(-1);
  });

  it('in Eastern, the plan\'s own words', () => {
    expect(MEET_WEEK_SLOTS.map((_, i) => slotLabel(slotStart(WINTER, i), 'America/New_York'))).toEqual([
      'Fri 7–8 am ET', 'Fri 12–1 pm ET', 'Fri 6–7 pm ET', 'Fri 8–9 pm ET',
      'Sat 8–9 am ET', 'Sat 9–10 am ET', 'Sat 11 am–12 pm ET', 'Sat 2–3 pm ET',
    ]);
    expect(slotLabel(slotStart(SPRING, 6), 'America/Toronto')).toBe('Sat 11 am–12 pm ET');
  });

  it('elsewhere, her own time with Eastern in brackets, naming Eastern\'s day only when it differs', () => {
    expect(slotLabel(slotStart(WINTER, 0), 'America/Los_Angeles')).toBe('Fri 4–5 am (7–8 am ET)');
    expect(slotLabel(slotStart(WINTER, 6), 'America/Chicago')).toBe('Sat 10–11 am (11 am–12 pm ET)');
    expect(slotLabel(slotStart(WINTER, 3), 'Asia/Tokyo')).toBe('Sat 10–11 am (Fri 8–9 pm ET)');
    expect(slotLabel(slotStart(WINTER, 0), 'Asia/Kolkata')).toBe('Fri 5:30–6:30 pm (7–8 am ET)');
    expect(slotLabel(slotStart(WINTER, 3), 'America/Los_Angeles')).toBe('Fri 5–6 pm (8–9 pm ET)');
  });
});

describe('when (3.2, 5.23)', () => {
  it('a real meet\'s hour is set 72 hours before the window: Tuesday 6 am Eastern; the column wins when set', () => {
    expect(hourSetAt({ opensAt: WINTER }).toISOString()).toBe('2027-02-23T11:00:00.000Z');
    const cut = new Date('2026-11-10T12:00:00Z');
    expect(hourSetAt({ opensAt: WINTER, flightHourCutoffAt: cut })).toBe(cut);
  });

  it('meet week runs from the Monday of week 12 (Eastern) until the window opens', () => {
    expect(weekTwelveMonday('2026-12-07')).toBe('2027-02-22');
    expect(inMeetWeek('2026-12-07', WINTER, new Date('2027-02-22T04:30:00Z'))).toBe(false); // Sun 11:30 pm ET
    expect(inMeetWeek('2026-12-07', WINTER, new Date('2027-02-22T05:30:00Z'))).toBe(true); // Mon 12:30 am ET
    expect(inMeetWeek('2026-12-07', WINTER, new Date('2027-02-26T10:59:59Z'))).toBe(true);
    expect(inMeetWeek('2026-12-07', WINTER, WINTER)).toBe(false);
    expect(inMeetWeek(null, WINTER, new Date('2027-02-23T00:00:00Z'))).toBe(false);
  });
});

describe('the flight\'s hour (5.23)', () => {
  it('the most ticks; a tie goes to the earliest slot; nobody ticked, no hour', () => {
    expect(flightWinner([2, 0, 0, 0, 0, 2, 0, 0])).toBe(0);
    expect(flightWinner([2, 0, 0, 0, 0, 3, 0, 0])).toBe(5);
    expect(flightWinner([0, 0, 1, 0, 0, 1, 0, 0])).toBe(2);
    expect(flightWinner([0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it('the counts\' words', () => {
    expect(tickedLine(4)).toBe('4 in your flight ticked this');
    expect(tickedLine(0)).toBe('');
    expect(pickedLine(1)).toBe('1 of your flight picked this');
    expect(pickedLine(3)).toBe('3 of your flight picked this');
  });
});

describe('the checklist (5.23)', () => {
  it('Barbell: one per lift in meet order, in the attempt card\'s words, joined with "; "', () => {
    expect(barbellChecklistLine([{ lift: 'squat', weight: 100 }, { lift: 'bench', weight: 65 }, { lift: 'deadlift', weight: 135 }], 'lb'))
      .toBe('Your bar and plates for your openers: squat 100 lb, 45 lb bar + a green 25 and a 2½ on each side; bench press 65 lb, 45 lb bar + a white 10 on each side; deadlift 135 lb, 45 lb bar + a blue 45 on each side');
  });

  it('Home: her meet weights, each once, as she owns them', () => {
    expect(homeChecklistLine([
      { lift: 'squat', weight: 25, kind: 'bell' }, { lift: 'bench', weight: 15 }, { lift: 'deadlift', weight: 15, kind: 'pair' },
    ], 'lb')).toBe('Your weights for your openers: One 25 lb dumbbell, two 15 lb dumbbells');
  });
});
