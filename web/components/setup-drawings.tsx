// Try a lift's set-up drawings (plan 5.2 step 2), drawn to look 7's how-to spec:
// 120×120 frames, a 2 px non-scaling ink stroke, square caps, miter joins, the floor
// at y = 108 as a 1 px rule line, and a neutral side-on figure 96 units tall
// (head r 7, torso 34, thigh 26, shin 26, upper arm 18, forearm 16).

const S = { fill: 'none', stroke: 'var(--ink)', strokeWidth: 2, strokeLinecap: 'square', strokeLinejoin: 'miter', vectorEffect: 'non-scaling-stroke' } as const;
const CUE = { fill: 'none', stroke: 'var(--ink-3)', strokeWidth: 1.5, strokeDasharray: '4 4', vectorEffect: 'non-scaling-stroke' } as const;

function Floor() {
  return <line x1="0" y1="108" x2="120" y2="108" stroke="var(--rule)" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
}

/** A standing figure, side-on, feet at (x, 108). */
function Standing({ x }: { x: number }) {
  // ankle 108, knee 82, hip 56, shoulder 22; head r 7 sits on the torso.
  return (
    <g {...S}>
      <circle cx={x} cy={15} r={7} />
      <path d={`M${x} 22 V56 L${x + 1} 82 L${x} 108 M${x - 4} 108 H${x + 6}`} />
      <path d={`M${x} 26 L${x + 2} 44 L${x + 3} 60`} />
    </g>
  );
}

/** A phone standing up on the floor, leaning back on a mug. */
function PhoneOnMug({ x, scale = 1 }: { x: number; scale?: number }) {
  return (
    <g transform={`translate(${x} 108) scale(${scale})`} {...S}>
      <rect x="-7" y="-30" width="14" height="30" rx="2" transform="rotate(-8)" />
      <path d="M2 -16 H18 V0 H2 Z M18 -12 H22 V-5 H18" transform="translate(4 0)" />
    </g>
  );
}

export function SetupDrawing({ n }: { n: 1 | 2 | 3 }) {
  return (
    <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true" className="setup-drawing">
      <Floor />
      {n === 1 && <PhoneOnMug x={52} scale={1.6} />}
      {n === 2 && (
        <>
          <PhoneOnMug x={14} scale={0.8} />
          <Standing x={92} />
          <path {...CUE} d="M40 98 Q58 88 76 98" />
          <path {...CUE} strokeDasharray="none" d="M71 93 L76 98 L69 100" />
        </>
      )}
      {n === 3 && (
        <>
          <PhoneOnMug x={14} scale={0.8} />
          <Standing x={92} />
          <path {...CUE} d="M18 88 L86 8 M18 88 L104 108" />
        </>
      )}
    </svg>
  );
}
