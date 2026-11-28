// The meet card as Satori draws it (plan 5.30, look 9 "The meet card" and "The card images"): the Story
// (1080 × 1920) and the Post (1080 × 1350). Every size is the sample's `.meetcard` (390 px wide) times
// K = 1080 / 390, so the PNG matches lookiebot/sample.html's card side by side. Satori has no font-stretch,
// so each weight and width is its own family (web/card-fonts, cut by scripts/cut-card-fonts.py).
import type { CardView } from '@/lib/card/card-view';
import { CARD_FOOTER } from '@/lib/card/card-view';
import type { BestLiftView } from '@/lib/card/best-lift';
import { BODY_ADVANCE, NAME_ADVANCE } from '@/lib/card/card-metrics';

export const K = 1080 / 390;
const px = (n: number) => Math.round(n * K * 100) / 100;

export const FORMATS = { story: { width: 1080, height: 1920 }, post: { width: 1080, height: 1350 } } as const;
export type CardFormat = keyof typeof FORMATS;

// The card is always on --stage (look 9), so it takes the Lights down plate colours.
export const C = {
  stage: '#0D0E13', ink: '#F1EFE8', ink2: '#A6A9B3', ink3: '#8A8E9A', rule: '#2A2D37', bar: '#6E737C',
  lampWhite: '#FFF4D8', bezel: '#2C2F39',
};
const PLATE_FILL: Record<number, string> = {
  55: '#D7262B', 45: '#2E62DD', 35: '#F2C230', 25: '#24A05A', 10: '#F6F5F0', 5: '#4A4E5A', 2.5: '#B9BDC4',
};
// the sample's drawBar table: lb, thickness, height
const PLATE_SIZE: Record<number, [number, number]> = { 55: [15, 64], 45: [13, 64], 35: [11, 64], 25: [9, 64], 10: [7, 64], 5: [6, 40], 2.5: [5, 32] };
const KG_AS_LB: Record<number, number> = { 25: 55, 20: 45, 15: 35, 10: 25, 5: 10, 2.5: 5, 1.25: 2.5 };

export const F = {
  total: 'Anybody 900 130', weight: 'Anybody 900 120', wordmark: 'Anybody 800 112', name: 'Anybody 800 104',
  tag: 'Anybody 800 88', unit: 'Anybody 700 100', eyebrow: 'Anybody 700 88', body: 'Atkinson 400', italic: 'Atkinson 400 italic',
};

const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

/**
 * A lit white lamp with its settled glow (look 9: "an embedded SVG with a feGaussianBlur"), the sample's
 * `.lamp.white` with `::after` at rest: the two box-shadow glows (blur 90 and 26, so stdDeviation 45 and 13
 * at the sample's size), the 1 px ring, the 5 px bezel, the core's radial gradient, and the bloom at .75
 * painted over the lamp, as `::after` is. `d` is the lamp's diameter in card pixels (1080 scale).
 */
export function lampSvg(d: number, color: 'white' | 'red' = 'white') {
  const s = d / 68; // the sample's 68 px lamp is the unit
  const pad = Math.ceil(130 * s);
  const W = d + 2 * pad, c = W / 2, r = d / 2;
  const glow = color === 'white' ? '255,230,175' : '240,48,42';
  const [g0, g1, g2] = color === 'white' ? ['#FFFFFF', C.lampWhite, '#F2DFB2'] : ['#FFB2A4', '#F0302A', '#B5160F'];
  const stops = color === 'white' ? [0.18, 0.46, 1] : [0.12, 0.52, 1];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
<defs>
<radialGradient id="core" cx="0.46" cy="0.42" r="0.79" fx="0.46" fy="0.42"><stop offset="0" stop-color="${g0}"/><stop offset="${stops[0]}" stop-color="${g0}"/><stop offset="${stops[1]}" stop-color="${g1}"/><stop offset="${stops[2]}" stop-color="${g2}"/></radialGradient>
<radialGradient id="bloom" gradientUnits="userSpaceOnUse" cx="${c}" cy="${c}" r="${(r + 34 * s) * Math.SQRT2}"><stop offset="0" stop-color="rgb(${glow})" stop-opacity="0.45"/><stop offset="0.66" stop-color="rgb(${glow})" stop-opacity="0"/></radialGradient>
<filter id="far" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${45 * s}"/></filter>
<filter id="near" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${13 * s}"/></filter>
</defs>
<circle cx="${c}" cy="${c}" r="${r + 20 * s}" fill="rgb(${glow})" fill-opacity="0.28" filter="url(#far)"/>
<circle cx="${c}" cy="${c}" r="${r + 6 * s}" fill="rgb(${glow})" fill-opacity="0.55" filter="url(#near)"/>
<circle cx="${c}" cy="${c}" r="${r + 6 * s}" fill="rgb(255,255,255)" fill-opacity="0.1"/>
<circle cx="${c}" cy="${c}" r="${r + 5 * s}" fill="${C.bezel}"/>
<circle cx="${c}" cy="${c}" r="${r}" fill="url(#core)"/>
<circle cx="${c}" cy="${c}" r="${r + 34 * s}" fill="url(#bloom)" opacity="0.75"/>
</svg>`;
  return { uri: svgUri(svg), size: W, pad };
}

/** The sample's drawBar(svg, total, {w:330, h:56, scale:.8}): the bar edge-on with its real plates. */
export function barSvg(plates: number[], units: 'lb' | 'kg', w = 330, h = 56, s = 0.8) {
  const mid = h / 2, cL = w * 0.25, cR = w * 0.75;
  const r = (x: number, y: number, ww: number, hh: number, rx: number, fill: string, extra = '') =>
    `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="${rx}" fill="${fill}"${extra}/>`;
  const parts = [
    r(cL, mid - 2.5 * s, cR - cL, 5 * s, 0, C.bar),
    r(0, mid - 5 * s, cL, 10 * s, 2, C.bar),
    r(cR, mid - 5 * s, w - cR, 10 * s, 2, C.bar),
    r(cL - 3 * s, mid - 9 * s, 6 * s, 18 * s, 1, C.bar),
    r(cR - 3 * s, mid - 9 * s, 6 * s, 18 * s, 1, C.bar),
  ];
  let xL = cL - 3 * s - 1, xR = cR + 3 * s + 1;
  for (const p of plates) {
    const lb = units === 'kg' ? KG_AS_LB[p] : p;
    const [t, ph] = PLATE_SIZE[lb];
    const tw = Math.max(3, t * s * 1.3), hh = Math.min(ph * s, h - 4), rx = Math.min(2, tw / 3);
    const stroke = lb === 10 ? ` stroke="${C.ink}" stroke-width="1.2"` : '';
    parts.push(r(xL - tw, mid - hh / 2, tw, hh, rx, PLATE_FILL[lb], stroke), r(xR, mid - hh / 2, tw, hh, rx, PLATE_FILL[lb], stroke));
    xL -= tw + 1.5; xR += tw + 1.5;
  }
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${w * K}" height="${h * K}" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`);
}

function Lamps({ size, gap }: { size: number; gap: number }) {
  const l = lampSvg(size);
  return (
    <div style={{ display: 'flex', gap }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ display: 'flex', position: 'relative', width: size, height: size }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={l.uri} width={l.size} height={l.size} alt="" style={{ position: 'absolute', left: -l.pad, top: -l.pad }} />
        </div>
      ))}
    </div>
  );
}

function Wordmark({ season }: { season: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
      <span style={{ fontFamily: F.wordmark, fontSize: px(18), lineHeight: `${px(28)}px`, letterSpacing: px(18) * -0.005, color: C.ink }}>First Meet</span>
      <span style={{ fontFamily: F.eyebrow, fontSize: px(13), lineHeight: `${px(28)}px`, letterSpacing: px(13) * 0.1, color: C.ink2 }}>{season}</span>
    </div>
  );
}

function Name({ v, wrap = false, size = 34 }: { v: Pick<CardView, 'name' | 'meta'>; wrap?: boolean; size?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, ...(wrap ? { flexShrink: 1, minWidth: 0, width: '100%', wordBreak: 'break-word' as const } : {}) }}>
      <div style={{ fontFamily: F.name, fontSize: px(size), lineHeight: `${px(size * 36 / 34)}px`, letterSpacing: px(size) * -0.01, color: C.ink }}>{v.name}</div>
      <div style={{ fontFamily: F.body, fontSize: px(16), lineHeight: `${px(22)}px`, color: C.ink2, marginTop: px(6) }}>{v.meta}</div>
    </div>
  );
}

function Total({ v, size = 118 }: { v: CardView; size?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: px(26), flexShrink: 0 }}>
      <div style={{ fontFamily: F.total, fontSize: px(size), lineHeight: `${px(size * TOTAL_LINE)}px`, letterSpacing: px(size) * -0.04, color: C.ink }}>{v.total}</div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: px(10) }}>
        <span style={{ fontFamily: F.unit, fontSize: px(20), lineHeight: `${px(24)}px`, letterSpacing: px(20) * 0.06, color: C.ink2 }}>{v.unitLine}</span>
        {v.nineForNine && (
          <span style={{
            fontFamily: F.tag, fontSize: px(13), lineHeight: `${px(16)}px`, letterSpacing: px(13) * 0.1, color: C.stage,
            background: C.lampWhite, padding: `${px(4)}px ${px(8)}px`, borderRadius: px(3), marginLeft: px(10),
          }}>9 FOR 9</span>
        )}
      </div>
    </div>
  );
}

function Lifts({ v }: { v: CardView }) {
  return (
    <div style={{ display: 'flex', flexShrink: 0, gap: px(10), marginTop: px(16), paddingTop: px(16), borderTop: `${px(1)}px solid ${C.rule}` }}>
      {v.lifts.map(l => (
        <div key={l.lift} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span style={{ fontFamily: F.eyebrow, fontSize: px(13), lineHeight: `${px(28)}px`, letterSpacing: px(13) * 0.09, color: C.ink3 }}>{l.label}</span>
          <span style={{ fontFamily: F.name, fontSize: px(26), lineHeight: `${px(30)}px`, color: C.ink }}>{l.written ?? l.value}</span>
        </div>
      ))}
    </div>
  );
}

function Foot() {
  return (
    <div style={{ display: 'flex', flexShrink: 0, marginTop: px(18), fontFamily: F.body, fontSize: px(13), lineHeight: `${px(18)}px`, color: C.ink3 }}>
      {CARD_FOOTER}
    </div>
  );
}

function Heaviest({ v }: { v: CardView }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, marginTop: 'auto', paddingTop: px(20) }}>
      {v.heaviest.weight !== null && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={barSvg(v.heaviest.plates, v.units)} width={px(330)} height={px(56)} alt="" />
      )}
      <span style={{ fontFamily: F.body, fontSize: px(13), lineHeight: `${px(18)}px`, color: C.ink3, marginTop: px(6) }}>{v.heaviest.line}</span>
    </div>
  );
}

const frame = (w: number, h: number) => ({
  display: 'flex', flexDirection: 'column' as const, width: w, height: h, background: C.stage, color: C.ink,
  padding: `${px(34)}px ${px(30)}px ${px(30)}px`,
});

/** Story, 9:16 (look 9): header, three lamps, name, total, the heaviest bar, the three lifts, the footer. */
export function StoryCard({ v }: { v: CardView }) {
  return (
    <div style={frame(1080, 1920)}>
      <Wordmark season={v.season} />
      {/* the sample's 44 / 38 px around the lamps; a long plate line (the heaviest bar's words can wrap to two
          or three lines) takes its room from here, so the footer never leaves the card */}
      <div style={{ display: 'flex', height: px(44), flexShrink: 1 }} />
      <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}><Lamps size={px(68)} gap={px(18)} /></div>
      <div style={{ display: 'flex', height: px(38), flexShrink: 1 }} />
      <Name v={v} />
      <Total v={v} />
      <Heaviest v={v} />
      <Lifts v={v} />
      <Foot />
    </div>
  );
}

// Anybody 900 wdth 130's advance widths (web/card-fonts/anybody-900-130.ttf, 2000 units to the em), for the weight's fit
const TOTAL_ADVANCE: Record<string, number> = { 0: 1702, 1: 1636, 2: 1756, 3: 1748, 4: 1688, 5: 1729, 6: 1751, 7: 1574, 8: 1721, 9: 1760, '.': 670, ',': 873 };

/** The weight's width in the total's face at `size`, with its -0.04em tracking: the sample's 390 px scale. */
export const totalFaceWidth = (text: string, size: number) =>
  [...text].reduce((w, ch) => w + (TOTAL_ADVANCE[ch] ?? 1760) / 2000 * size, 0) - 0.04 * size * Math.max(0, text.length - 1);

/** Look 9: 118 px, stepped down 2 px at a time until it fits the 330 px column (`102.5`). */
export function bestWeightSize(text: string, column = 330) {
  let size = 118;
  while (size > 40 && totalFaceWidth(text, size) > column) size -= 2;
  return size;
}

/**
 * The bomb-out clip's end frame (look 9 "The bomb-out clip", item 101): the story card with the total, the heaviest
 * bar, the three lifts and 9 FOR 9 taken out, and the best-lift block where the total sits. Nothing below it.
 */
export function BestLiftCard({ v }: { v: BestLiftView }) {
  const size = bestWeightSize(v.weight);
  return (
    <div style={frame(1080, 1920)}>
      <Wordmark season={v.season} />
      <div style={{ display: 'flex', height: px(44), flexShrink: 0 }} />
      <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}><Lamps size={px(68)} gap={px(18)} /></div>
      <div style={{ display: 'flex', height: px(38), flexShrink: 0 }} />
      <Name v={v} />
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: px(26), flexShrink: 0 }}>
        <span style={{ fontFamily: F.eyebrow, fontSize: px(13), lineHeight: `${px(16)}px`, letterSpacing: px(13) * 0.09, color: C.ink2 }}>BEST LIFT</span>
        <span style={{ fontFamily: F.tag, fontSize: px(17), lineHeight: `${px(20)}px`, letterSpacing: px(17) * 0.04, color: C.ink, marginTop: px(10) }}>{v.liftLine}</span>
        <div style={{ fontFamily: F.total, fontSize: px(size), lineHeight: `${px(size * 0.85)}px`, letterSpacing: px(size) * -0.04, color: C.ink, marginTop: px(6) }}>{v.weight}</div>
        <span style={{ fontFamily: F.unit, fontSize: px(20), lineHeight: `${px(24)}px`, letterSpacing: px(20) * 0.06, color: C.ink2, marginTop: px(10) }}>{v.unitLine.toUpperCase()}</span>
      </div>
      <div style={{ display: 'flex', flex: 1 }} />
      <Foot />
    </div>
  );
}

/** Post, 4:5 (look 9): the lamps and the name side by side, and the heaviest bar dropped. */
/** How many lines `text` wraps to in `width` (the sample's 390 px scale), breaking at spaces and after hyphens. */
export function wrappedLines(text: string, advance: Record<string, number>, size: number, tracking: number, width: number) {
  const widest = Math.max(...Object.values(advance));
  // 2 % over, so a line it counts as fitting never wraps in Satori: a card counts a line too many, never too few
  const w = (s: string) => [...s].reduce((a, ch) => a + ((advance[ch] ?? widest) / 2000 + tracking) * size, 0) * 1.02;
  const words = text.trim().split(/\s+/).flatMap(word => word.split(/(?<=-)/)).filter(Boolean);
  let lines = 1;
  let line = '';
  for (const word of words) {
    const next = line ? (line.endsWith('-') ? line + word : `${line} ${word}`) : word;
    if (!line || w(next) <= width) { line = next; continue; }
    lines++;
    line = word;
  }
  // a word wider than the column breaks inside itself (wordBreak below)
  return words.reduce((n, word) => n + Math.max(0, Math.ceil(w(word) / width) - 1), lines);
}

// The Post's height in the sample's scale, and everything in it but the total's line (look 9): the padding, the
// header, the 40 above the lamps row, the 26 under the meta, the unit line, the three lifts and the footer.
const POST_H = 1350 / K;
const POST_FIXED = 34 + 30 + 28 + 40 + 26 + 10 + 24 + 16 + 16 + 1 + 28 + 30 + 18 + 18;
// the name column beside the lamps: the card less its padding, three 40 px lamps 10 apart, and the 22 px gap
const POST_NAME_COLUMN = 390 - 60 - (3 * 40 + 2 * 10) - 22;
const TOTAL_LINE = 100 / 118;

/**
 * The Post's name and meta lines and the total's size (LookieBot at e0e2353): the name and meta wrap inside the
 * padding, the total sits 26 under them, and when the stack doesn't fit it steps down, as `bestWeightSize` does,
 * rather than overlap.
 */
export function postLayout(v: Pick<CardView, 'name' | 'meta' | 'total'>) {
  const metaLines = v.meta ? wrappedLines(v.meta, BODY_ADVANCE, 16, 0, POST_NAME_COLUMN) : 0;
  const fit = (nameSize: number) => {
    const nameLines = wrappedLines(v.name, NAME_ADVANCE, nameSize, -0.01, POST_NAME_COLUMN);
    const row = Math.max(40, nameLines * nameSize * 36 / 34 + (metaLines ? 6 + metaLines * 22 : 0));
    let size = Math.min(118, bestWeightSize(v.total, 330));
    while (size > 40 && size * TOTAL_LINE > POST_H - POST_FIXED - row) size -= 2;
    return { nameSize, nameLines, metaLines, row, size };
  };
  // the total steps down first; a name so long the total would go under 72 steps down itself, to 20 at the least
  let out = fit(34);
  for (let n = 32; out.size < POST_TOTAL_FLOOR && n >= 20; n -= 2) out = fit(n);
  return out;
}
const POST_TOTAL_FLOOR = 72;

export function PostCard({ v }: { v: CardView }) {
  const { size, nameSize, row } = postLayout(v);
  return (
    <div style={frame(1080, 1350)}>
      <Wordmark season={v.season} />
      <div style={{ display: 'flex', alignItems: 'center', gap: px(22), margin: `${px(40)}px 0 0`, flexShrink: 0, height: px(row) }}>
        <Lamps size={px(40)} gap={px(10)} />
        <div style={{ display: 'flex', flex: 1, minWidth: 0 }}><Name v={v} wrap size={nameSize} /></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}><Total v={v} size={size} /></div>
      <Lifts v={v} />
      <Foot />
    </div>
  );
}
