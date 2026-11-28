// Plan 5.3 and piece 22: the sample meet's data, its replay's chapters, and the awards on it (phase 5's "done").
import { describe, expect, it } from 'vitest';
import data from '../../content/sample-meet.json';
import {
  CHAPTERS, CLOSE_AT, CLOSE_CALL, CLOSE_LANDS_AT, FEATURED, REPLAY_S, SAMPLE_LIFTERS, SAMPLE_LIGHTS,
  chapterAt, liftersAt, rollCall, sampleCardView, sampleLifter, tickerAt, totalsAt,
} from '@/lib/sample-meet';
import { awards, boardRows, ordinal, placeOf, shownRows } from '@/lib/board';
import { meetTotal } from '@/lib/meet';

describe('the sample meet data (5.3)', () => {
  it('has 40 made-up lifters, each with nine attempts', () => {
    expect(data.lifters).toHaveLength(40);
    for (const l of data.lifters) expect(l.attempts).toHaveLength(9);
  });
  it('names everyone by a first name and a last initial only, never a full name', () => {
    for (const l of data.lifters) expect(l.name).toMatch(/^[A-Z][a-z]+ [A-Z]\.$/);
    expect(new Set(data.lifters.map(l => l.name)).size).toBe(40);
  });
  it('gives everyone an age group, a division and a hometown', () => {
    for (const l of data.lifters) {
      expect(['Open', '40–49', '50–59', '60–69', '70+']).toContain(l.ageGroup);
      expect(['barbell', 'home']).toContain(l.division);
      expect(l.hometown).toMatch(/^[A-Z][\w .]+, [A-Z]{2}$/);
    }
  });
  it('has about 1 in 8 attempts red, and 2 close calls', () => {
    const all = data.lifters.flatMap(l => l.attempts);
    const red = all.filter(a => a.call === 'red').length / all.length;
    expect(red).toBeGreaterThan(0.1);
    expect(red).toBeLessThan(0.15);
    expect(all.filter(a => 'close' in a && a.close)).toHaveLength(2);
  });
  it('has Rosa M. as the plan has her, with her line', () => {
    const r = sampleLifter('Rosa M.');
    expect([r.ageGroup, r.division, r.hometown]).toEqual(['60–69', 'barbell', 'Tucson, AZ']);
    expect(r.line).toBe('I started at 63 because my granddaughter asked me to.');
    const t = meetTotal(r.attempts, r.division);
    expect(t.kind === 'total' && t.value).toBe(290);
  });
  it('has Dana W. at 345 lb, 9 for 9, and draws her card', () => {
    const d = sampleLifter('Dana W.');
    expect([d.ageGroup, d.division]).toEqual(['50–59', 'barbell']);
    const t = meetTotal(d.attempts, d.division);
    expect(t.kind === 'total' && [t.value, t.nineForNine]).toEqual([345, true]);
    const v = sampleCardView()!;
    expect([v.name, v.total, v.units]).toEqual(['Dana W.', '345', 'lb']);
  });
});

describe('the replay (piece 22)', () => {
  it('plays in 90 s, with its five chapters in order inside it', () => {
    expect(REPLAY_S).toBe(90);
    expect(CHAPTERS.map(c => c.label)).toEqual([
      'Friday 6 am · the platform opens', 'Saturday morning · lights land', 'A close call', '8 pm · meet night', 'Her card',
    ]);
    const at = CHAPTERS.map(c => c.at);
    expect(at[0]).toBe(0);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(at[4]).toBeLessThan(REPLAY_S);
  });
  it('every chapter can be jumped to: its start is in that chapter', () => {
    CHAPTERS.forEach((c, i) => expect(chapterAt(c.at)).toBe(i));
    expect(chapterAt(REPLAY_S)).toBe(4);
  });
  it('opens on an empty board with the count at 0', () => {
    expect(totalsAt(0)).toBe(0);
    expect(tickerAt(0)).toEqual([]);
  });
  it('fills the ticker (8 at most, newest first) and the board through Saturday', () => {
    const mid = tickerAt(30);
    expect(mid).toHaveLength(8);
    expect(SAMPLE_LIGHTS.indexOf(mid[0])).toBeGreaterThan(SAMPLE_LIGHTS.indexOf(mid[7]));
    expect(totalsAt(CHAPTERS[3].at)).toBe(boardRows(SAMPLE_LIFTERS, 'barbell').length + boardRows(SAMPLE_LIFTERS, 'home').length);
    expect(totalsAt(CHAPTERS[3].at)).toBeGreaterThan(totalsAt(30));
  });
  it('lights three drawn attempts, one red for depth', () => {
    expect(FEATURED.map(f => [f.lift, f.call])).toEqual([['squat', 'white'], ['bench', 'white'], ['squat', 'red']]);
    expect(FEATURED[2].reason).toBe('depth');
  });
  it('has a close call that lands 2 whites and 1 red, 6 s later', () => {
    expect(CLOSE_LANDS_AT - CLOSE_AT).toBe(6);
    expect(CLOSE_CALL.lights.filter(l => l === 'white')).toHaveLength(2);
    expect(CLOSE_CALL.call).toBe('white');
  });
  it('rolls everyone who totaled, oldest age group first', () => {
    const r = rollCall(SAMPLE_LIFTERS);
    expect(r.length).toBe(totalsAt(REPLAY_S));
    expect(r[0].ageGroup).toBe('70+');
    expect(r[r.length - 1].ageGroup).toBe('Open');
    expect(liftersAt(REPLAY_S).every((l, i) => l.attempts.length === SAMPLE_LIFTERS[i].attempts.length)).toBe(true);
  });
});

describe('the board and awards on the sample data (5.31, phase 5 "done")', () => {
  const barbell = boardRows(SAMPLE_LIFTERS, 'barbell');
  const home = boardRows(SAMPLE_LIFTERS, 'home');
  const list = awards(SAMPLE_LIFTERS);
  const of = (kind: string) => list.filter(a => a.kind === kind);
  const totalOf = (id: string) => [...barbell, ...home].find(r => r.id === id)!.total;

  it('keeps the two divisions apart, and leaves a lifter with no total off the board', () => {
    expect(barbell.every(r => r.division === 'barbell')).toBe(true);
    expect(home.every(r => r.division === 'home')).toBe(true);
    expect(barbell.length + home.length).toBeLessThan(40);
  });
  it('places best total first, and places within an age group when filtered', () => {
    for (let i = 1; i < barbell.length; i++) expect(barbell[i - 1].total).toBeGreaterThanOrEqual(barbell[i].total);
    const g = shownRows(barbell, '50–59');
    expect(g[0].place).toBe(1);
    expect(g.every(r => r.ageGroup === '50–59')).toBe(true);
    const dana = sampleLifter('Dana W.');
    const p = placeOf(barbell, dana.id)!;
    expect(shownRows(barbell, '50–59', 'dana')).toEqual([expect.objectContaining({ name: 'Dana W.', place: p.place })]);
  });
  it('writes Home lift cells as "25 × 8"', () => {
    expect(home[0].lifts.squat.text).toMatch(/^\d+ × \d+$/);
  });
  it('gives "9 for 9" to exactly the lifters with nine good lifts, Dana among them', () => {
    const nine = SAMPLE_LIFTERS.filter(l => l.attempts.every(a => a.call === 'white'));
    expect(of('nine_for_nine').map(a => a.lifterId).sort()).toEqual(nine.map(l => l.id).sort());
    expect(of('nine_for_nine').map(a => a.name)).toContain('Dana W.');
  });
  it('gives "Top total" to the top of each division and age group', () => {
    for (const a of of('top_total')) {
      const rows = a.division === 'home' ? home : barbell;
      const top = Math.max(...rows.filter(r => r.ageGroup === a.ageGroup).map(r => r.total));
      expect(totalOf(a.lifterId)).toBe(top);
    }
    const groups = (rows: typeof barbell) => new Set(rows.map(r => r.ageGroup)).size;
    expect(of('top_total')).toHaveLength(groups(barbell) + groups(home));
  });
  it('gives "First total over 60" to every 60+ lifter who totaled, Rosa among them', () => {
    const over = [...barbell, ...home].filter(r => r.ageGroup === '60–69' || r.ageGroup === '70+');
    expect(of('first_over_60').map(a => a.lifterId).sort()).toEqual(over.map(r => r.id).sort());
    expect(of('first_over_60').map(a => a.name)).toContain('Rosa M.');
  });
  it('gives "Oldest lifter to total" to the oldest who totaled in each division', () => {
    for (const d of ['barbell', 'home'] as const) {
      const rows = d === 'home' ? home : barbell;
      const ages = rows.map(r => SAMPLE_LIFTERS.find(l => l.id === r.id)!.age!);
      const got = of('oldest').filter(a => a.division === d);
      expect(got.length).toBeGreaterThan(0);
      for (const a of got) expect(SAMPLE_LIFTERS.find(l => l.id === a.lifterId)!.age).toBe(Math.max(...ages));
    }
  });
  it('gives "Biggest comeback" to the biggest jump from a red attempt 1 to a heavier white attempt 3', () => {
    const jumps = SAMPLE_LIFTERS.filter(l => l.division === 'barbell' && barbell.some(r => r.id === l.id)).flatMap(l => (['squat', 'bench', 'deadlift'] as const).flatMap(lift => {
      const a1 = l.attempts.find(a => a.lift === lift && a.number === 1)!, a3 = l.attempts.find(a => a.lift === lift && a.number === 3)!;
      return a1.call === 'red' && a3.call === 'white' && a3.weight > a1.weight ? [{ id: l.id, jump: a3.weight - a1.weight, third: a3.weight }] : [];
    }));
    expect(jumps.length).toBeGreaterThan(0);
    const most = Math.max(...jumps.map(j => j.jump));
    const won = of('comeback').filter(a => a.division === 'barbell');
    // one winner, from those with the biggest jump; on a tie, the heaviest attempt 3
    expect(won).toHaveLength(1);
    const tied = jumps.filter(j => j.jump === most);
    const heaviest = Math.max(...tied.map(j => j.third));
    expect(tied.filter(j => j.third === heaviest).map(j => j.id)).toContain(won[0].lifterId);
    expect(won[0].reason).toMatch(new RegExp(`no lift at ${heaviest - most} lb on attempt 1, then a good lift at ${heaviest} lb on attempt 3$`));
    expect(of('comeback').filter(a => a.division === 'home')).toHaveLength(1);
  });
  it('words places as ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  });
});
