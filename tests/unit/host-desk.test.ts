// Piece 12 (plan 5.35): the host desk's queues and the roll call's order and pace.
import { describe, expect, it } from 'vitest';
import { leftLine, namesPerPage, readoutQueues, readoutsInOrder, rollEntries, rollEntriesInOrder, rollLine, rollPace, smallMeetLine, splitRows, type HostLifter } from '@/lib/host';
import { LIFTS, type MeetAttempt } from '@/lib/meet';
import { SAMPLE_LIFTERS } from '@/lib/sample-meet';
import { deskQueues } from '@/components/host-live';

const GROUPS = ['Open', '40–49', '50–59', '60–69', '70+'];

/** A lifter with eight good lifts (deadlift 3 is red, so no award) at `base` lb (squat), base − 40 (bench), base + 20 (deadlift). */
function lifter(i: number, base = 100 + (i % 50), ageGroup = GROUPS[i % 5]): HostLifter {
  const attempts: MeetAttempt[] = LIFTS.flatMap((lift, li) => [1, 2, 3].map(number => ({
    lift, number, weight: base + (lift === 'bench' ? -40 : lift === 'deadlift' ? 20 : 0) + number * 5,
    repsDeclared: null, status: 'judged', call: lift === 'deadlift' && number === 3 ? 'red' as const : 'white' as const, recordedAt: new Date(Date.UTC(2027, 1, 26, 13, 0, i + li * 3 + number)),
  })));
  return { id: `l${i}`, name: `Lifter ${i}`, ageGroup, age: null, division: 'barbell', units: 'lb', attempts, sayIt: '', line: '' };
}
const seed = (n: number) => Array.from({ length: n }, (_, i) => lifter(i));
/** No one over 60, so no "First total over 60" either. */
const under60 = (n: number) => Array.from({ length: n }, (_, i) => lifter(i, undefined, GROUPS[i % 3]));

describe('the roll call pace (5.35, piece 12)', () => {
  it('2,000 totals in 60 minutes: two rows, 3.6 s a name per row, done within the hour', () => {
    const p = rollPace(2000, 60);
    expect(p.rows).toBe(2);
    expect(p.perRow).toBe(1000);
    expect(p.rowPace).toBeCloseTo(3.6, 9);
    expect(p.seconds).toBeLessThanOrEqual(3600);
  });
  it('the 2,000 seeded totals are all on the band, half on each row', () => {
    const roll = rollEntries(seed(2000));
    expect(roll).toHaveLength(2000);
    const [a, b] = splitRows(roll, rollPace(roll.length, 60).rows);
    expect(a).toHaveLength(1000);
    expect(b).toHaveLength(1000);
  });
  it('one row while each name gets 3 s or more, up to 600 totals', () => {
    expect(rollPace(600, 60)).toMatchObject({ rows: 1, rowPace: 6 });
    expect(rollPace(1000, 60)).toMatchObject({ rows: 2, perRow: 500, rowPace: 6 });
    expect(rollPace(500, 20)).toMatchObject({ rows: 2, perRow: 250, rowPace: 4.8 });
    expect(rollPace(300, 20)).toMatchObject({ rows: 1, rowPace: 4 });
  });
  it('keeps a name between 1.5 s and 6 s', () => {
    expect(rollPace(10, 60).rowPace).toBe(6);
    expect(rollPace(10_000, 60)).toMatchObject({ rows: 2, rowPace: 1.5 });
    expect(rollPace(0, 60).seconds).toBe(0);
  });
  it('pages the roll call with reduced motion, a page every 18 s', () => {
    expect(namesPerPage(3.6)).toBe(5);
    expect(namesPerPage(6)).toBe(3);
    expect(namesPerPage(1.5)).toBe(12);
  });
});

describe('the roll call order (5.35)', () => {
  it('runs oldest age group first', () => {
    const order = rollEntries(seed(50)).map(e => e.ageGroup);
    const firstOf = (g: string) => order.indexOf(g);
    expect(firstOf('70+')).toBe(0);
    expect(firstOf('60–69')).toBeLessThan(firstOf('50–59'));
    expect(firstOf('40–49')).toBeLessThan(firstOf('Open'));
    expect(order.lastIndexOf('70+')).toBeLessThan(firstOf('60–69'));
  });
  it('two rows alternate names, so both rows start with the oldest', () => {
    const roll = rollEntries(seed(20));
    const [a, b] = splitRows(roll, 2);
    expect(a[0].ageGroup).toBe('70+');
    expect(b[0].ageGroup).toBe('70+');
    expect([...a, ...b].map(e => e.id).sort()).toEqual(roll.map(e => e.id).sort());
  });
  it('leaves out a lifter with no total', () => {
    const list = seed(5);
    list[0] = { ...list[0], attempts: list[0].attempts.map(a => (a.lift === 'bench' ? { ...a, call: 'red' } : a)) };
    expect(rollEntries(list).map(e => e.id)).not.toContain('l0');
  });
});

describe('the read-out queues (5.35)', () => {
  it('a small meet queues every first total, with the Caption', () => {
    const qs = readoutQueues(under60(150));
    expect(qs.map(q => q.eyebrow)).toEqual(['AGE-GROUP LEADERS', 'FIRST TOTALS']);
    expect(qs.reduce((n, q) => n + q.items.length, 0)).toBe(150);
    expect(smallMeetLine(150)).toBe('150 totals tonight: you could read every name.');
  });
  it('over 150 totals, no FIRST TOTALS list', () => {
    expect(readoutQueues(seed(151)).map(q => q.eyebrow)).not.toContain('FIRST TOTALS');
  });
  it('awards first, then the leaders; each lifter once', () => {
    const qs = readoutQueues(SAMPLE_LIFTERS);
    expect(qs.map(q => q.eyebrow)).toEqual(['AWARDS', 'AGE-GROUP LEADERS', 'FIRST TOTALS']);
    const ids = qs.flatMap(q => q.items.map(i => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(qs[0].items.every(i => i.award)).toBe(true);
    expect(qs[0].items.some(i => i.award?.includes('Top total'))).toBe(false);
  });
  it('the leaders are the top 3 of each age group in each division', () => {
    const leaders = readoutQueues(under60(40)).find(q => q.eyebrow === 'AGE-GROUP LEADERS')!.items;
    expect(leaders).toHaveLength(9);
    expect(leaders.slice(0, 3).every(i => i.ageGroup === '50–59')).toBe(true);
    expect(leaders.slice(0, 3).map(i => Number(i.total))).toEqual([...leaders.slice(0, 3).map(i => Number(i.total))].sort((a, b) => b - a));
  });
  it('a 60+ lifter is read with her award, not again as a leader', () => {
    const qs = readoutQueues(seed(40));
    expect(qs[0].eyebrow).toBe('AWARDS');
    expect(qs[0].items.every(i => i.award === 'First total over 60')).toBe(true);
    expect(qs[1].items.some(i => i.ageGroup === '70+' || i.ageGroup === '60–69')).toBe(false);
  });
  it('carries what the card shows: how to say it, hometown, total, her line', () => {
    const r = readoutQueues(SAMPLE_LIFTERS).flatMap(q => q.items).find(i => i.name === 'Rosa M.')!;
    expect(r).toMatchObject({ ageGroup: '60–69', division: 'Barbell', hometown: 'Tucson, AZ', total: '290', units: 'lb', line: 'I started at 63 because my granddaughter asked me to.' });
    expect(r.sayIt).toBeTruthy();
  });
  it('leaves out who was read or skipped already', () => {
    const all = readoutQueues(seed(10)).flatMap(q => q.items.map(i => i.id));
    const left = readoutQueues(seed(10), new Set(all.slice(0, 4))).flatMap(q => q.items.map(i => i.id));
    expect(left).toEqual(all.slice(4));
    expect(leftLine(3)).toBe('3 left in this list');
  });
});

describe('the roll call line (5.35)', () => {
  it('says how far along it is and when it ends, Eastern', () => {
    expect(rollLine(412, 2000, new Date('2027-02-28T02:04:00Z'))).toBe('Roll call: 412 of 2,000 · ends about 9:04 pm');
    expect(rollLine(2000, 2000, new Date())).toBe('Roll call: 2,000 of 2,000');
  });
});

describe('the sample host desk (5.36)', () => {
  // newest first, as sampleDeskLifters gives them: the best total last, so only the given order can put it first
  const demo = [lifter(1, 100), lifter(2, 150), lifter(3, 200)].map(l => ({ ...l, ageGroup: 'Open' }));
  const newestFirst = demo.map(l => l.id);

  it('reads the demo lifters first, newest first, under FIRST TOTALS, then the sample meet', () => {
    const qs = deskQueues(SAMPLE_LIFTERS, demo, new Set());
    expect(qs[0].eyebrow).toBe('FIRST TOTALS');
    expect(qs[0].items.map(r => r.id)).toEqual(newestFirst);
    expect(qs.slice(1)).toEqual(readoutQueues(SAMPLE_LIFTERS));
    expect(readoutsInOrder(demo).map(r => r.id)).toEqual(newestFirst);
  });
  it('leaves out the demo lifters already read or skipped', () => {
    const qs = deskQueues(SAMPLE_LIFTERS, demo, new Set([newestFirst[0]]));
    expect(qs[0].items.map(r => r.id)).toEqual(newestFirst.slice(1));
    expect(deskQueues(SAMPLE_LIFTERS, demo, new Set(newestFirst))[0].eyebrow).not.toBe('FIRST TOTALS');
  });
  it('starts the roll call with the demo lifters, newest first', () => {
    expect(rollEntriesInOrder(demo).map(e => e.id)).toEqual(newestFirst);
    expect(rollEntries(demo).map(e => e.id)).not.toEqual(newestFirst);
  });
});
