// The meet card as Satori draws it (plan 5.30, look 9 "The meet card" and "The card images"): the Story
// (1080 × 1920) and the Post (1080 × 1350). Every size is the sample's `.meetcard` (390 px wide) times
// K = 1080 / 390, so the PNG matches lookiebot/sample.html's card side by side. Satori has no font-stretch,
// so each weight and width is its own family (web/card-fonts, cut by scripts/cut-card-fonts.py).
import type { CardView } from '@/lib/card/card-view';
import { CARD_FOOTER } from '@/lib/card/card-view';

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

function Name({ v }: { v: CardView }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ fontFamily: F.name, fontSize: px(34), lineHeight: `${px(36)}px`, letterSpacing: px(34) * -0.01, color: C.ink }}>{v.name}</div>
      <div style={{ fontFamily: F.body, fontSize: px(16), lineHeight: `${px(22)}px`, color: C.ink2, marginTop: px(6) }}>{v.meta}</div>
    </div>
  );
}

function Total({ v }: { v: CardView }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: px(26), flexShrink: 0 }}>
      <div style={{ fontFamily: F.total, fontSize: px(118), lineHeight: `${px(100)}px`, letterSpacing: px(118) * -0.04, color: C.ink }}>{v.total}</div>
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

/** Post, 4:5 (look 9): the lamps and the name side by side, and the heaviest bar dropped. */
export function PostCard({ v }: { v: CardView }) {
  return (
    <div style={frame(1080, 1350)}>
      <Wordmark season={v.season} />
      <div style={{ display: 'flex', alignItems: 'center', gap: px(22), margin: `${px(40)}px 0 0` }}>
        <Lamps size={px(40)} gap={px(10)} />
        <div style={{ display: 'flex', flex: 1 }}><Name v={v} /></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}><Total v={v} /></div>
      <Lifts v={v} />
      <Foot />
    </div>
  );
}
