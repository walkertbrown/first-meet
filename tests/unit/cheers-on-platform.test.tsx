// Item 80 (plan 5.24, 5.28; look 5.10): how her cheers read, one banner at a time and never while
// she lifts; and the demo flight (5.36) whose attempts she can cheer from the strip.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cheerCount, cheeredYouOn, cornerBlock, namesOf, oneCheerParts, partsText, waitingParts, type HerCheer } from '../../web/lib/cheer-words';
import { CheerBanner, YourCorner, step, type Shown } from '../../web/components/cheer-banner';
import { DEMO_FLIGHT_CYCLE_S, DEMO_FLIGHT_NAMES, demoFlightAt, isDemoFlightId } from '../../web/lib/demo-flight';

const c = (id: string, name: string | null, kind: HerCheer['kind'] = 'strong'): HerCheer => ({ id, kind, who: name ? name.toLowerCase() : null, name });
const momx3 = [c('1', 'Mom'), c('2', null), c('3', 'Mom'), c('4', 'Dee'), c('5', 'Mom'), c('6', 'Ana'), c('7', null)];

describe('her cheers in words (5.24, "<names>, in the banner and on her total")', () => {
  it('one cheer: the name is the Strong part, or "Someone in your corner"', () => {
    expect(oneCheerParts('white_lights', 'Mom')).toEqual([{ t: 'Mom', strong: true }, { t: ' cheered: White lights!' }]);
    expect(partsText(oneCheerParts('strong', null))).toBe('Someone in your corner cheered: Strong!');
    expect(partsText(waitingParts([c('1', 'Dana')]))).toBe('Dana cheered: Strong!');
    expect(partsText(waitingParts([c('1', null)]))).toBe('Someone in your corner cheered: Strong!');
  });

  it("NerdCider's six cases, as The Playner answered them", () => {
    expect(partsText(waitingParts([c('1', 'Mom'), c('2', 'Mom')]))).toBe('Mom cheered you on.');
    expect(partsText(waitingParts([c('1', null), c('2', null), c('3', null)]))).toBe('Your corner cheered you on.');
    expect(partsText(waitingParts([c('1', null), c('2', 'Mom')]))).toBe('Mom cheered you on.');
    expect(partsText(waitingParts([c('1', 'Mom'), c('2', 'Mom'), c('3', 'Mom'), c('4', 'Dee'), c('5', 'Ana')]))).toBe('Mom, Dee and 1 more cheered you on.');
    expect(partsText(waitingParts([c('1', 'Mom'), c('2', 'Dee')]))).toBe('Mom and Dee cheered you on.');
    expect(partsText(cornerBlock([c('1', null), c('2', null)])!.line)).toBe('Your corner cheered you on this weekend.');
  });

  it("the plan's worked example: Mom ×3, Dee, Ana and two with no name", () => {
    expect(partsText(waitingParts(momx3))).toBe('Mom, Dee and 1 more cheered you on.');
    const b = cornerBlock(momx3)!;
    expect(partsText(b.line)).toBe('Mom, Dee and Ana cheered you on this weekend.');
    expect(b.line.filter(p => p.strong).map(p => p.t)).toEqual(['Mom', 'Dee', 'Ana']);
    expect(b.count).toBe('7 cheers');
  });

  it('a person once, matched ignoring case; five names on the total, then "and <k> more" people', () => {
    expect(namesOf([c('1', 'Mom'), { id: '2', kind: 'strong', who: 'mom', name: 'MOM' }])).toEqual(['Mom']);
    const six = ['A', 'B', 'C', 'D', 'E', 'F'];
    expect(partsText(cheeredYouOn(six, 5, ' this weekend'))).toBe('A, B, C, D, E and 1 more cheered you on this weekend.');
    expect(partsText(cheeredYouOn(six.slice(0, 5), 5, ' this weekend'))).toBe('A, B, C, D and E cheered you on this weekend.');
    expect(cheerCount(1)).toBe('1 cheer');
    expect(cornerBlock([])).toBeNull();
  });
});

describe('one banner at a time, never while she lifts (look 5.10)', () => {
  type L = string;
  const lit: Shown<L> = { kind: 'lights', b: 'squat 2', k: 1 };
  const cheer: Shown<L> = { kind: 'cheer', list: [c('9', 'Dee')], k: 2 };

  it('while she lifts nothing drops in, and one showing goes', () => {
    expect(step<L>({ busy: true, shown: null, lights: ['squat 2'], unseen: [c('1', 'Mom')] })).toBeNull();
    expect(step<L>({ busy: true, shown: lit, lights: [], unseen: [] })).toEqual({ shown: null, lights: [], seen: [] });
  });

  it('once she has settled: a lights banner before a waiting cheer, then the cheers together', () => {
    const a = step<L>({ busy: false, shown: null, lights: ['squat 2'], unseen: [c('1', 'Mom'), c('2', 'Dee')] })!;
    expect(a.shown).toMatchObject({ kind: 'lights', b: 'squat 2' });
    expect(a.seen).toEqual([]);
    expect(step<L>({ busy: false, shown: a.shown, lights: a.lights, unseen: [c('1', 'Mom')] })).toBeNull(); // waits for the lights
    const b = step<L>({ busy: false, shown: null, lights: [], unseen: [c('1', 'Mom'), c('2', 'Dee')] })!;
    expect(b.shown).toMatchObject({ kind: 'cheer', list: [{ id: '1' }, { id: '2' }] });
    expect(b.seen).toEqual(['1', '2']);
  });

  it('a newer cheer takes the cheer banner\'s place and its 8 s start again', () => {
    const r = step<L>({ busy: false, shown: cheer, lights: [], unseen: [c('10', 'Ana')] })!;
    expect(r.shown).toMatchObject({ kind: 'cheer', list: [{ id: '10' }] });
    expect(r.shown!.k).not.toBe(cheer.k);
    expect(step<L>({ busy: false, shown: cheer, lights: [], unseen: [] })).toBeNull();
  });

  it('the cheer banner: no lamps, the name Strong, role="status"; her corner on the total', () => {
    const html = renderToStaticMarkup(<CheerBanner list={[c('1', 'Dana')]} k={1} onDismiss={() => {}} />);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('mini-lamp');
    expect(html).toContain('<strong>Dana</strong><span> cheered: Strong!</span>');
    const corner = renderToStaticMarkup(<YourCorner corner={cornerBlock(momx3)} />);
    expect(corner).toContain('<span class="eyebrow">YOUR CORNER</span>');
    expect(corner).toContain('<strong>Mom</strong><span>, </span><strong>Dee</strong><span> and </span><strong>Ana</strong>');
    expect(corner).toContain('7 cheers');
    expect(renderToStaticMarkup(<YourCorner corner={null} />)).toBe('');
  });
});

describe('the demo flight (5.36)', () => {
  const T0 = new Date(DEMO_FLIGHT_CYCLE_S * 1000 * 1000);
  it('six flightmates, each lifting her nine; one lands every 20–40 s, the same every loop', () => {
    expect(DEMO_FLIGHT_NAMES).toHaveLength(6);
    let at = T0.getTime() + 1, landed = 0, last = demoFlightAt(new Date(at), 'barbell', 'lb');
    for (let i = 0; i < 54; i++) {
      const gap = last.nextAt - at;
      expect(gap).toBeGreaterThan(0);
      at = last.nextAt;
      const now = demoFlightAt(new Date(at), 'barbell', 'lb');
      expect(now.rows[0].id).not.toBe(last.rows[0].id);
      expect(now.nextAt - at).toBeGreaterThanOrEqual(20_000);
      expect(now.nextAt - at).toBeLessThanOrEqual(40_000);
      last = now; landed++;
    }
    expect(landed).toBe(54);
  });

  it('newest first, three rows, each with three lights; the words for each division and unit', () => {
    const f = demoFlightAt(new Date(T0.getTime() + 600_000), 'barbell', 'lb');
    expect(f.rows).toHaveLength(3);
    expect(f.rows.every(r => r.lights.length === 3 && isDemoFlightId(r.id))).toBe(true);
    expect(f.rows[0].what).toMatch(/^(Squat|Bench press|Deadlift) [123] · \d+$/);
    const home = demoFlightAt(new Date(T0.getTime() + 600_000), 'home', 'kg');
    expect(home.rows[0].what).toMatch(/ [123] · [\d.]+ × (8|10|12)$/);
  });

  it('only its own ids are demo ids', () => {
    expect(isDemoFlightId('flight-123-5')).toBe(true);
    expect(isDemoFlightId('june-5-1')).toBe(false);
    expect(isDemoFlightId('00000000-0000-4000-8000-000000000001')).toBe(false);
  });
});
