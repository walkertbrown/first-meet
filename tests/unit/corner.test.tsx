// Her corner page (plan 5.4) and June Okafor's (5.36): June's clock, the page's words, the cheer
// sheet with item 79 off and on, and cheers on June's page (taken, never kept).
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/db', () => ({ db: () => ({}), hasDb: () => true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }), notFound() { throw new Error('404'); } }));

import { JUNE_CYCLE_S, isJuneAttemptId, juneAt } from '../../web/lib/june';
import { beforeTitle, juneView, notStartedLine, weekendWords } from '../../web/lib/corner-view';
import { cheerEyebrow, cheerLine, cleanCornerName, sendCheer } from '../../web/lib/cheers';

/** keepWhole's no-break marks, as plain text */
const plain = (s: string) => s.replace(/\u2060/g, '').replace(/\u00a0/g, ' ');
const at = (meet: number, s: number) => new Date(meet * JUNE_CYCLE_S * 1000 + s * 1000);

describe("June's clock (5.36)", () => {
  it('an attempt every 30 s: with the judges from 30k + 10, lit at 30k + 30, then 2 minutes and a fresh meet', () => {
    expect(JUNE_CYCLE_S).toBe(390);
    expect(juneAt(at(5, 0)).list).toEqual([]);
    expect(juneAt(at(5, 0)).nextAt).toBe(at(5, 10).getTime());
    const sent = juneAt(at(5, 10)).list;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: 'june-5-0', lift: 'squat', number: 1, weight: 135, status: 'judging', call: null, lights: [] });
    const lit = juneAt(at(5, 30));
    expect(lit.list[0]).toMatchObject({ status: 'judged', call: 'white', lights: ['white', 'white', 'white'] });
    expect(lit.nextAt).toBe(at(5, 40).getTime());
    expect(juneAt(at(5, 89)).list.map(a => a.call)).toEqual(['white', 'white', null]);
    const done = juneAt(at(5, 270));
    expect(done.list).toHaveLength(9);
    expect(done.list.map(a => `${a.lift} ${a.number} ${a.weight} ${a.call}`)).toEqual([
      'squat 1 135 white', 'squat 2 145 white', 'squat 3 155 red',
      'bench 1 85 white', 'bench 2 90 white', 'bench 3 95 red',
      'deadlift 1 185 white', 'deadlift 2 200 white', 'deadlift 3 210 white',
    ]);
    expect(done.nextAt).toBe(at(6, 0).getTime());
    expect(juneAt(at(6, 0)).list).toEqual([]);
  });

  it('her ids are what her cheers take, and nothing else is', () => {
    expect(isJuneAttemptId('june-5-8')).toBe(true);
    expect(isJuneAttemptId('june-5-9')).toBe(false);
    expect(isJuneAttemptId('00000000-0000-4000-8000-000000000001')).toBe(false);
  });

  it('her page: not started, live newest first, then "June Okafor totaled 445 lb."', () => {
    const before = juneView(at(5, 0));
    expect(before).toMatchObject({ kind: 'live', name: 'June Okafor', demo: true, june: true, list: [] });
    expect(before.kind === 'live' && before.notStarted).toBe('She hasn\'t started yet. Keep this page open and her lifts appear as they land.');
    const mid = juneView(at(5, 75));
    expect(mid.kind).toBe('live');
    if (mid.kind === 'gone' || mid.kind === 'before') throw new Error();
    expect(mid.list.map(r => plain(`${r.name} · ${r.weight} · ${r.state}`))).toEqual([
      'Squat 3 · 155 lb · looking', 'Squat 2 · 145 lb · white', 'Squat 1 · 135 lb · white',
    ]);
    expect(mid.list[0].lights).toEqual([]);
    expect(mid.list[1].lights).toEqual(['white', 'red', 'white']);
    const end = juneView(at(5, 300));
    expect(end).toMatchObject({ kind: 'totaled', total: '445', unit: 'lb' });
  });
});

describe('the corner page words (5.4)', () => {
  it('the weekend in Eastern dates, and "this weekend" inside 7 days', () => {
    const opens = new Date('2027-02-26T11:00:00Z'), closes = new Date('2027-02-27T23:00:00Z');
    expect(plain(weekendWords(opens, closes))).toBe('Feb 26–27');
    expect(plain(beforeTitle('Dana', opens, closes, new Date('2027-02-01T12:00:00Z')))).toBe('Dana lifts on Feb 26–27.');
    expect(beforeTitle('Dana', opens, closes, new Date('2027-02-22T12:00:00Z'))).toBe('Dana lifts this weekend.');
    expect(plain(weekendWords(new Date('2027-02-28T15:00:00Z'), new Date('2027-03-01T15:00:00Z')))).toBe('Feb 28 – Mar 1');
  });

  it('before her first attempt, with the platform\'s close in Eastern', () => {
    expect(plain(notStartedLine(new Date('2027-02-27T23:00:00Z'))))
      .toBe('She hasn\'t started yet. The platform is open until Saturday 6 pm Eastern. Keep this page open and her lifts appear as they land.');
  });

  it('a first name: letters, spaces, \' and - only, up to 30', () => {
    expect(cleanCornerName('  Mary  Jo ')).toBe('Mary Jo');
    expect(cleanCornerName("O'Brien-Lee")).toBe("O'Brien-Lee");
    expect(cleanCornerName('Zoë')).toBe('Zoë');
    expect(cleanCornerName('')).toBeNull();
    expect(cleanCornerName(' - ')).toBeNull();
    expect(cleanCornerName('<b>hi</b>')).toBeNull();
    expect(cleanCornerName('a'.repeat(31))).toBeNull();
  });

  it('what she reads when one lands', () => {
    expect(cheerLine('strong', 'Dana')).toBe('Dana cheered: Strong!');
    expect(cheerLine('white_lights', null)).toBe('Someone in your corner cheered: White lights!');
  });
});

describe('the cheer sheet (5.4, look 5.8)', () => {
  const row = { name: 'Squat 2' };
  it('the four, in order, as Ghosts; the 1:12 AM copy has no Eyebrow', async () => {
    const { CheerSheet } = await import('../../web/components/corner');
    const html = renderToStaticMarkup(<CheerSheet lifter="June Okafor" row={row} name={null} onClose={() => {}} onSend={() => {}} item79={false} />);
    expect([...html.matchAll(/class="btn ghost cheer-choice">([^<]+)</g)].map(m => m[1]))
      .toEqual(['White lights!', 'Strong!', 'You&#x27;ve got this', 'See you on the platform']);
    expect(html).not.toContain('eyebrow');
  });

  it('item 79 on: "Cheer <card_name> · <Lift> <n>" (the type sets the capitals), and a session\'s words', async () => {
    const { CheerSheet } = await import('../../web/components/corner');
    const html = renderToStaticMarkup(<CheerSheet lifter="June Okafor" row={row} name={null} onClose={() => {}} onSend={() => {}} item79 />);
    expect(html).toContain('<span class="eyebrow cheer-eyebrow">Cheer June Okafor · Squat 2</span>');
    expect(cheerEyebrow('Dana', 'session')).toBe('Cheer Dana · today\'s session');
  });
});

describe("cheers on June's page", () => {
  it('a cheer on June is taken and nothing is kept; a bad one is turned away', async () => {
    const none = {} as never; // any database call would throw
    expect(await sendCheer(none, 'demo', { attempt_id: 'june-5-1', kind: 'strong', name: 'Dana' })).toEqual({ status: 200, kind: 'strong' });
    expect(await sendCheer(none, 'demo', { attempt_id: 'june-5-1', kind: 'strong' })).toEqual({ status: 200, kind: 'strong' });
    expect((await sendCheer(none, 'demo', { attempt_id: 'june-5-1', kind: 'boo' })).status).toBe(400);
    expect((await sendCheer(none, 'demo', { attempt_id: 'june-5-1', kind: 'strong', name: '<script>' })).status).toBe(400);
    expect((await sendCheer(none, 'demo', { attempt_id: 'nope', kind: 'strong' })).status).toBe(404);
  });

  it('the route answers with the same status', async () => {
    const { POST } = await import('../../web/app/api/corner/[token]/cheer/route');
    const r = await POST(new Request('http://x/api/corner/demo/cheer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attempt_id: 'june-0-0', kind: 'see_you' }) }), { params: Promise.resolve({ token: 'demo' }) });
    expect(r.status).toBe(200);
  });
});
