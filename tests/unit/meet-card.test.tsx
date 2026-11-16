// The meet card (plan 5.30, 5.5, look 9): its words, its heaviest bar, and the Satori PNGs at their sizes.
import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { MeetAttempt } from '@/lib/meet';
import { cardView, heaviestOf, metaLine, ogTitle, publicBody, CARD_FOOTER, HONEST_LINE } from '@/lib/card/card-view';
import { cardImage } from '@/lib/card/card-png';
import { totalWords } from '@/lib/total-view';

const at = (lift: MeetAttempt['lift'], weight: number, extra: Partial<MeetAttempt> = {}): MeetAttempt =>
  ({ lift, number: 3, weight, repsDeclared: null, status: 'judged', call: 'white', recordedAt: new Date(), ...extra });

const barbell = { squat: at('squat', 135), bench: at('bench', 85), deadlift: at('deadlift', 155) };
const her = { cardName: 'Diane R.', ageGroup: '50–59', division: 'barbell' as const, hometown: 'Asbury Park, NJ', units: 'lb' as const };

/** The PNG's rows as RGBA (Satori's PNGs are 8-bit RGBA, not interlaced). */
function pngRows(b: Buffer): { w: number; h: number; px: (x: number, y: number) => number[] } {
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  expect([b[24], b[25]]).toEqual([8, 6]);
  const idat: Buffer[] = [];
  for (let o = 8; o < b.length;) {
    const len = b.readUInt32BE(o), type = b.subarray(o + 4, o + 8).toString();
    if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * 4, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0, up = y ? out[(y - 1) * stride + x] : 0, c = y && x >= 4 ? out[(y - 1) * stride + x - 4] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      const pred = [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f];
      out[y * stride + x] = (row[x] + pred) & 255;
    }
  }
  return { w, h, px: (x, y) => [...out.subarray(y * stride + x * 4, y * stride + x * 4 + 3)] };
}

function pngSize(b: Buffer) {
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('the meet card view', () => {
  it('reads as look 9: meta, season, total, unit line, the three lifts', () => {
    const v = cardView(her, 'Winter 2027', { value: 375, best: barbell, nineForNine: true });
    expect(v.meta).toBe('50–59 · Barbell · Asbury Park, NJ');
    expect(v.season).toBe('WINTER 2027');
    expect(v.total).toBe('375');
    expect(v.unitLine).toBe('LB TOTAL');
    expect(v.lifts.map(l => l.value)).toEqual(['135', '85', '155']);
    expect(v.nineForNine).toBe(true);
  });

  it("draws the heaviest bar with the app's own plates and words", () => {
    const h = heaviestOf(barbell, 'barbell', 'lb');
    expect(h.weight).toBe(155);
    expect(h.plates).toEqual([45, 10]);
    expect(h.line).toBe('Heaviest bar · 155 lb deadlift · a blue 45 and a white 10 each side');
  });

  it('Home: "<UNIT> LIFTED", "25 × 8" lifts, and "Best set" in place of the bar (5.30, look 5.14b)', () => {
    const home = {
      squat: at('squat', 25, { repsDeclared: 10 }), bench: at('bench', 15, { repsDeclared: 8, homeLoad: 30 }), deadlift: at('deadlift', 25, { repsDeclared: 8 }),
    };
    const v = cardView({ ...her, division: 'home' }, 'Winter 2027', { value: 570, best: home, nineForNine: false });
    expect(v.unitLine).toBe('LB LIFTED');
    expect(v.heaviest.weight).toBeNull();
    expect(v.heaviest.line).toMatch(/^Best set · \d+ lb (bell|dumbbells) × \d+$/);
    expect(v.lifts.every(l => /×/.test(l.written ?? l.value))).toBe(true);
  });

  it('leaves out a missing age group or hometown', () => {
    expect(metaLine({ ageGroup: null, division: 'home', hometown: ' ' })).toBe('Home');
  });

  it("has the plan's exact words", () => {
    expect(CARD_FOOTER).toBe('Hosted by Love Soo · @lovesoostrong');
    expect(HONEST_LINE).toBe("A prototype built for Love Soo's audience for Hack the Audience 2026.");
    expect(ogTitle({ name: 'Diane R.', total: '375', units: 'lb' })).toBe('Diane R. totaled 375 lb at First Meet');
    expect(publicBody('Diane R.')).toBe('Diane R. did her first powerlifting meet at First Meet, hosted by Love Soo.');
  });

  it('5.28: the total\'s Primary is "See my meet card"', () => {
    expect(totalWords(true).primary).toEqual({ label: 'See my meet card', href: '/me/card' });
    expect(totalWords(false).primary).toEqual({ label: 'See my meet card', href: '/me/card' });
  });
});

describe('the card PNGs (Satori)', () => {
  const v = cardView(her, 'Winter 2027', { value: 375, best: barbell, nineForNine: true });
  const out = process.env.CARD_PNG_OUT;

  it.each([['story', 1080, 1920], ['post', 1080, 1350]] as const)('%s is %i × %i', async (f, w, h) => {
    const r = await cardImage(v, f);
    const b = Buffer.from(await r.arrayBuffer());
    expect(pngSize(b)).toEqual({ w, h });
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(`${out}/${f}.png`, b); }
  }, 30_000);

  // the longest plate lines wrap; the card's bottom padding (30 px at the sample's size) stays empty stage
  it.each([[400, 'lb'], [182.5, 'kg']] as const)('a %s %s deadlift: the footer stays inside the card', async (dl, units) => {
    const heavy = cardView({ ...her, units }, 'Winter 2027', { value: dl * 2, best: { ...barbell, deadlift: at('deadlift', dl) }, nineForNine: false });
    expect(heavy.heaviest.line.length).toBeGreaterThan(80);
    const png = pngRows(Buffer.from(await (await cardImage(heavy, 'story')).arrayBuffer()));
    if (out) writeFileSync(`${out}/story-${dl}${units}.png`, Buffer.from(await (await cardImage(heavy, 'story')).arrayBuffer()));
    const pad = Math.floor(30 * (1080 / 390)) - 2;
    for (let y = png.h - pad; y < png.h; y += 4) for (let x = 0; x < png.w; x += 6) expect(png.px(x, y)).toEqual([0x0d, 0x0e, 0x13]);
  }, 30_000);
});
