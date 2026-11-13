'use client';
// Which way the phone stands, in the browser (plan 3.10, look 4a and 4b). Gravity first (`devicemotion`),
// so rotation lock can't break it; where there is none (no sensor, or she said "Not now" on an iPhone),
// the screen's own shape on a touch phone; on a desktop, nothing (no turning, no gating).
import { useCallback, useEffect, useRef, useState } from 'react';
import { GravityWatch, phoneKind, wayOf, type PhoneKind, type Quarter, type Way } from './orient';

type AskFn = () => Promise<'granted' | 'denied' | 'default'>;
const asker = (): AskFn | null => {
  const D = typeof window !== 'undefined' ? (window as unknown as { DeviceMotionEvent?: { requestPermission?: AskFn } }).DeviceMotionEvent : undefined;
  return typeof D?.requestPermission === 'function' ? D.requestPermission.bind(D) : null;
};

const KEY = 'fm-motion';
export type MotionAnswer = 'granted' | 'not-now';
const readAnswer = (): MotionAnswer | null => {
  try { const v = localStorage.getItem(KEY); return v === 'granted' || v === 'not-now' ? v : null; } catch { return null; }
};
const saveAnswer = (v: MotionAnswer) => { try { localStorage.setItem(KEY, v); } catch { /* private mode: asked again next time */ } };

export type Orientation = {
  /** gravity's way, else the screen's on a touch phone, else null (no gating) */
  way: Way | null;
  /** the settled quarter from gravity, or null when gravity says nothing */
  quarter: Quarter | null;
  /** the screen itself is wider than tall */
  screenSide: boolean;
  kind: PhoneKind;
  /** an iPhone that hasn't been asked: the motion step shows before the first bench's camera (look 4b) */
  needsAsk: boolean;
  /** the iPhone said no, or she chose "Not now": the turn drawing keeps its rotation-lock line */
  noMotion: boolean;
  /** live, for the camera loop: gravity's watch, fed on every sample */
  watch: GravityWatch;
  /** her tap on "Allow motion & orientation", then iPhone's own question */
  allow: () => Promise<void>;
  notNow: () => void;
  /** on a tap: an iPhone that said yes before gets its permission back with no question */
  renew: () => void;
};

export function useOrientation(): Orientation {
  const watchRef = useRef<GravityWatch | null>(null);
  // iPhones can report the axes the other way round; the watch learns the real sign from upright samples
  watchRef.current ??= new GravityWatch(asker() ? -1 : 1);
  const [quarter, setQuarter] = useState<Quarter | null>(null);
  const [screenSide, setScreenSide] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const [answer, setAnswer] = useState<MotionAnswer | null>(null);
  const [asks, setAsks] = useState(false);
  const [denied, setDenied] = useState(false);
  const [kind, setKind] = useState<PhoneKind>(null);
  /** no gravity sample in the first 1.5 s: no sensor, or one that hasn't been allowed */
  const [silent, setSilent] = useState(false);

  useEffect(() => {
    setAnswer(readAnswer());
    setAsks(asker() !== null);
    setKind(phoneKind(navigator.userAgent, asker() !== null));
    const land = window.matchMedia('(orientation: landscape)');
    const touch = window.matchMedia('(pointer: coarse)');
    const on = () => { setScreenSide(land.matches); setCoarse(touch.matches); };
    on();
    land.addEventListener('change', on);
    touch.addEventListener('change', on);
    const w = watchRef.current!;
    let heard = false;
    const quiet = setTimeout(() => { if (!heard) setSilent(true); }, 1500);
    const motion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (g?.x != null && g.y != null && !heard) { heard = true; setSilent(false); }
      if (g && w.feed(g.x, g.y, e.timeStamp || performance.now())) setQuarter(w.quarter);
    };
    window.addEventListener('devicemotion', motion);
    return () => {
      clearTimeout(quiet);
      land.removeEventListener('change', on);
      touch.removeEventListener('change', on);
      window.removeEventListener('devicemotion', motion);
    };
  }, []);

  const allow = useCallback(async () => {
    const ask = asker();
    let r: string = 'granted';
    try { if (ask) r = await ask(); } catch { r = 'denied'; }
    // look 4b: the step shows once; a "yes" is remembered on the device
    if (r === 'granted') { saveAnswer('granted'); setAnswer('granted'); }
    else { saveAnswer('not-now'); setAnswer('not-now'); setDenied(true); }
  }, []);
  const notNow = useCallback(() => { saveAnswer('not-now'); setAnswer('not-now'); }, []);
  const renew = useCallback(() => {
    const ask = asker();
    if (ask && readAnswer() === 'granted') void ask().then(r => { if (r !== 'granted') setDenied(true); }).catch(() => {});
  }, []);

  const gravityWay = quarter === null ? null : wayOf(quarter);
  return {
    way: gravityWay ?? (coarse ? (screenSide ? 'side' : 'tall') : null),
    quarter,
    screenSide,
    kind,
    needsAsk: asks && answer === null,
    noMotion: quarter === null && coarse && (asks ? denied || answer === 'not-now' : silent),
    watch: watchRef.current,
    allow,
    notNow,
    renew,
  };
}
