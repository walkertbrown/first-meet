'use client';
// Plan 5.1, desktop: "a muted 9:16 loop of the sample lift ending in three white
// lights: the look's stage, drawn as in the sample." The made-up, faceless lifter is
// LookieBot's drawing from sample.html, redrawn here; no real person is shown.
import { useEffect, useRef, useState } from 'react';
import { Lamps, type LampState } from './lamps';

const ANK = { x: 186, y: 500 }, SHIN = 94, THIGH = 98, TORSO = 118;
const rad = (d: number) => (d * Math.PI) / 180;

function pose(d: number) {
  const sh = rad(7 + 32 * d), th = rad(6 + 102 * d);
  const K = { x: ANK.x + SHIN * Math.sin(sh), y: ANK.y - SHIN * Math.cos(sh) };
  const Hp = { x: K.x - THIGH * Math.sin(th), y: K.y - THIGH * Math.cos(th) };
  const s = Math.max(-0.2, Math.min(0.85, (ANK.x + 14 - Hp.x) / TORSO));
  const to = Math.asin(s);
  const S = { x: Hp.x + TORSO * Math.sin(to), y: Hp.y - TORSO * Math.cos(to) };
  return { K, Hp, S, to };
}

function Lifter({ d }: { d: number }) {
  const { K, Hp, S, to } = pose(d);
  const head = { x: S.x + 30 * Math.sin(to) + 5, y: S.y - 30 * Math.cos(to) + 2 };
  const bar = { x: S.x - 6 * Math.cos(to) - 4, y: S.y + 6 * Math.sin(to) + 2 };
  const elbow = { x: bar.x - 24, y: bar.y + 26 };
  const sil = '#121216', rim = '#B59E7C';
  return (
    <>
      <g strokeLinecap="round" strokeLinejoin="round" fill="none">
        <line x1={ANK.x - 10} y1={ANK.y + 2} x2={ANK.x + 32} y2={ANK.y + 2} stroke={sil} strokeWidth="14" />
        <line x1={ANK.x} y1={ANK.y} x2={K.x} y2={K.y} stroke={sil} strokeWidth="24" />
        <line x1={K.x} y1={K.y} x2={Hp.x} y2={Hp.y} stroke={sil} strokeWidth="34" />
        <line x1={Hp.x} y1={Hp.y} x2={S.x} y2={S.y} stroke="#14141A" strokeWidth="42" />
        <line x1={Hp.x + 2} y1={Hp.y - 6} x2={S.x + 3} y2={S.y + 8} stroke={rim} strokeWidth="3" opacity=".55" transform="translate(19 0)" />
        <circle cx={head.x} cy={head.y} r="17" fill="#121217" stroke="none" />
        <path d={`M${head.x - 15} ${head.y - 6} q-10 8 -6 22`} stroke="#121217" strokeWidth="9" />
        <path d={`M${head.x + 4} ${head.y - 16} a17 17 0 0 1 13 14`} stroke={rim} strokeWidth="3" opacity=".7" />
        <polyline points={`${S.x},${S.y + 6} ${elbow.x},${elbow.y} ${bar.x + 2},${bar.y}`} stroke={sil} strokeWidth="13" />
      </g>
      <g>
        <circle cx={bar.x} cy={bar.y} r="46" fill="var(--plate-green)" opacity=".92" />
        <circle cx={bar.x} cy={bar.y} r="46" fill="none" stroke="#0B0B0E" strokeWidth="2" opacity=".5" />
        <circle cx={bar.x} cy={bar.y} r="40" fill="none" stroke="#000" strokeOpacity=".18" strokeWidth="2" />
        <circle cx={bar.x} cy={bar.y} r="11" fill="#9EA3AB" />
        <circle cx={bar.x} cy={bar.y} r="5" fill="#2A2C33" />
        <path d={`M${bar.x - 30} ${bar.y - 30} a42 42 0 0 1 36 -12`} stroke="#fff" strokeOpacity=".18" strokeWidth="3" fill="none" />
      </g>
    </>
  );
}

function Room({ d }: { d: number }) {
  return (
    <svg className="scene" viewBox="0 0 390 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="ll-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2B2A2E" /><stop offset=".7" stopColor="#3A3633" /><stop offset="1" stopColor="#2C2A2B" /></linearGradient>
        <radialGradient id="ll-bulb" cx=".86" cy=".28" r=".75"><stop offset="0" stopColor="#7A6C58" stopOpacity=".55" /><stop offset=".55" stopColor="#3A3530" stopOpacity=".12" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
        <linearGradient id="ll-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2A282C" /><stop offset="1" stopColor="#18171B" /></linearGradient>
        <filter id="ll-soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation=".7" /></filter>
      </defs>
      <rect width="390" height="600" fill="url(#ll-wall)" />
      <g opacity=".55" stroke="#3E3A37" strokeWidth="1">
        {Array.from({ length: 12 }, (_, i) => <line key={i} x1={-40 + i * 40} y1="0" x2={-40 + i * 40} y2="522" />)}
      </g>
      <rect x="262" y="236" width="128" height="6" fill="#4A4540" />
      <rect x="276" y="206" width="22" height="30" fill="#3E3A36" /><rect x="304" y="218" width="34" height="18" fill="#3A3633" /><rect x="346" y="200" width="16" height="36" fill="#45403B" />
      <rect width="390" height="600" fill="url(#ll-bulb)" />
      <rect y="522" width="390" height="78" fill="url(#ll-floor)" />
      <polygon points="30,548 372,548 400,600 0,600" fill="#17161A" />
      <line x1="0" y1="522" x2="390" y2="522" stroke="#4A4643" strokeWidth="1" />
      <g stroke="#45423F" strokeWidth="6" strokeLinecap="square"><line x1="62" y1="300" x2="62" y2="548" /><line x1="84" y1="296" x2="84" y2="540" /></g>
      <g stroke="#55514C" strokeWidth="4"><line x1="62" y1="372" x2="76" y2="372" /><line x1="84" y1="368" x2="98" y2="368" /></g>
      <g transform="translate(190 552) scale(.74) translate(-186 -500)">
        <g filter="url(#ll-soft)"><Lifter d={d} /></g>
      </g>
    </svg>
  );
}

// One loop, 9 s: stand, squat down and up (2.4 s), the dim, three lamps 330 ms apart, hold.
const LOOP = 9000;
const ease = (x: number) => 0.5 - Math.cos(Math.PI * x) / 2;
function depthAt(t: number) {
  if (t < 1000 || t > 3400) return 0;
  const x = (t - 1000) / 2400;
  return ease(x < 0.5 ? x * 2 : (1 - x) * 2);
}

export function LandingLoop() {
  const [t, setT] = useState(LOOP - 1);
  const [still, setStill] = useState(true);
  const raf = useRef(0);
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) return;
    setStill(false);
    const t0 = performance.now();
    const tick = (now: number) => {
      setT((now - t0) % LOOP);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);
  const lampAt = [4600, 4930, 5260];
  const states: LampState[] = lampAt.map(a => (t >= a ? 'white' : 'off'));
  const cls = ['stage', t >= 3600 && t < 4600 ? 'judging' : '', t >= 4600 ? 'lit' : ''].join(' ');
  return (
    <div className={`landing-loop ${cls}`} aria-hidden="true">
      <Room d={depthAt(t)} />
      <div className="dim" />
      <div className={`spill white${t >= 5260 ? ' on' : ''}`} />
      <Lamps states={states} settled={still} />
    </div>
  );
}
