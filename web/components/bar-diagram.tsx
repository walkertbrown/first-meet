// The bar diagram (look 5.7): the bar edge-on, its plates growing out from the collars, in the
// plates' own colours. Home draws her bell or dumbbells in --bar with an --ink outline instead.
'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { platesPerSide } from '@/lib/stage/meet-words';

const SIZE_LB: Record<number, [number, number]> = { 55: [19.5, 64], 45: [17, 64], 35: [14, 64], 25: [12, 64], 10: [9, 64], 5: [8, 40], 2.5: [6.5, 32] };
// kg plates map by colour (look 5.7): 25 red is the 55's place, 20 blue the 45's, and so on.
const KG_AS_LB: Record<number, number> = { 25: 55, 20: 45, 15: 35, 10: 25, 5: 10, 2.5: 5, 1.25: 2.5 };
const FILL_LB: Record<number, string> = {
  55: 'var(--plate-red)', 45: 'var(--plate-blue)', 35: 'var(--plate-yellow)', 25: 'var(--plate-green)', 10: 'var(--plate-white)', 5: 'var(--plate-change)', 2.5: 'var(--plate-chrome)',
};

/**
 * The drawing's width in its own units: the box's width, so the bar spans it (look 5.7). Read
 * against the box's drawn height, so a CSS height (44 px on short screens, look 5.6) scales the
 * shapes evenly and the sleeves still reach the edges.
 */
function useDrawWidth(height: number) {
  const ref = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width) setW(e.contentRect.width * (76 / (e.contentRect.height || height))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);
  return [ref, w] as const;
}

export function BarDiagram({ weight, units = 'lb', height = 76, label }: { weight: number; units?: 'lb' | 'kg'; height?: number; label: string }) {
  // Drawn at the card's width (look 5.7): the sleeves run to the edges and the collars sit at
  // 25% and 75% of it. Plates keep their sizes, so a wide card shows a long bar, not a big one.
  const [ref, W] = useDrawWidth(height);
  const H = 76, mid = H / 2;
  const plates = platesPerSide(weight, units).map(p => (units === 'kg' ? KG_AS_LB[p] : p));
  const cl = W * 0.25, cr = W * 0.75;
  const side = (dir: 1 | -1) => {
    let x = dir === 1 ? cr + 3 : cl - 3;
    return plates.map((p, i) => {
      const [w, h] = SIZE_LB[p];
      const left = dir === 1 ? x + 1.5 : x - 1.5 - w;
      x = dir === 1 ? left + w : left;
      return <rect key={`${dir}${i}`} x={left} y={mid - h / 2} width={w} height={h} rx={1.5} fill={FILL_LB[p]} stroke="var(--ink)" strokeOpacity={p === 10 ? 0.5 : 0.18} strokeWidth={1} />;
    });
  };
  return (
    <svg ref={ref} className="bar-diagram" viewBox={`0 0 ${W} ${H}`} height={height} width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
      <rect x={0} y={mid - 5} width={W} height={10} rx={2} fill="var(--bar)" />
      <rect x={cl} y={mid - 2.5} width={cr - cl} height={5} fill="var(--bar)" />
      <rect x={cl - 3} y={mid - 9} width={6} height={18} rx={1} fill="var(--bar)" stroke="var(--ink)" strokeOpacity={0.3} />
      <rect x={cr - 3} y={mid - 9} width={6} height={18} rx={1} fill="var(--bar)" stroke="var(--ink)" strokeOpacity={0.3} />
      {side(1)}
      {side(-1)}
    </svg>
  );
}

/** Home (look 5.7, 5.14b): her bell or dumbbell, drawn in --bar with an --ink outline. */
export function BellDiagram({ label, height = 76 }: { label: string; height?: number }) {
  return (
    <svg className="bar-diagram" viewBox="0 0 320 76" height={height} width="100%" role="img" aria-label={label}>
      <g fill="var(--bar)" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round">
        <rect x={104} y={12} width={26} height={52} rx={4} />
        <rect x={130} y={20} width={14} height={36} rx={3} />
        <rect x={144} y={33} width={32} height={10} rx={2} />
        <rect x={176} y={20} width={14} height={36} rx={3} />
        <rect x={190} y={12} width={26} height={52} rx={4} />
      </g>
    </svg>
  );
}
