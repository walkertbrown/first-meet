'use client';
// The sample meet's 90-second scripted replay (plan 5.3). Everything drawn is a pure function of the
// clock `t` (web/lib/sample-meet.ts), so Play, the scrub bar and the five chapter Eyebrows can put
// it at any moment. The scene shows the chapter; under the controls, the ticker and the board fill
// as the lights land, as they do on /live.
/* eslint-disable @next/next/no-img-element -- the card PNG is drawn at its final size by /api/card */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from '@phosphor-icons/react';
import type { Lift } from '@/db/schema';
import { Lamps, type LampState } from './lamps';
import { Board } from './board';
import { Ticker, type TickerItem } from './ticker';
import { LiftFigure } from './lift-figure';
import { DeskStage, DeskTop, ReadoutCard, RollBand } from './host-desk';
import { boardRows, shownRows, type Division } from '@/lib/board';
import { REASON_EYEBROW, type ReasonCode } from '@/lib/reason-words';
import {
  CHAPTERS, CLOSE_AT, CLOSE_CALL, CLOSE_LANDS_AT, FEATURED, FEATURED_AT, REPLAY_S, SAMPLE_CARD,
  chapterAt, liftersAt, rollCall, sampleLifter, tickerAt, totalsAt, SAMPLE_LIFTERS, type SampleLight,
} from '@/lib/sample-meet';

const LAMP_GAP = 0.33;
const ROSA = sampleLifter('Rosa M.');
// chapter 4's beats: Rosa's card, "Read" pressed, the text card, then the roll call scrolls
const READ_AT = 57, ROLL_AT = 62, ROLL_PX_S = 200;
const ROLL = rollCall(SAMPLE_LIFTERS);

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const liftLabel = (x: SampleLight) => `${({ squat: 'SQUAT', bench: 'BENCH', deadlift: 'DEADLIFT' } as Record<Lift, string>)[x.lift]} · ${x.number} OF 3`;

/** Three lamps that light 330 ms apart from `from`; before then, off (or pulsing, while a referee looks). */
function lampsAt(t: number, from: number, calls: ('white' | 'red')[], waiting = false): LampState[] {
  return calls.map((c, i) => (t >= from + i * LAMP_GAP ? c : waiting ? 'pulse' : 'off'));
}

function Featured({ t }: { t: number }) {
  const k = t < FEATURED_AT[1] - 1 ? 0 : t < FEATURED_AT[2] - 1 ? 1 : 2;
  const x = FEATURED[k], at = FEATURED_AT[k];
  const landed = t >= at + 2 * LAMP_GAP;
  return (
    <div className="scene-attempt" key={x.id}>
      <LiftFigure lift={x.lift} high={x.call === 'red' && x.reason === 'depth'} />
      <div className="scene-side">
        <span className="hud-label">{liftLabel(x)}</span>
        <p className="scene-who">{`${x.name} · ${x.weight} lb`}</p>
        <Lamps states={lampsAt(t, at, x.lights)} size={44} />
        <span className="eyebrow scene-reason" aria-hidden={!landed}>{landed && x.call === 'red' && x.reason ? REASON_EYEBROW[x.reason as ReasonCode] : ' '}</span>
      </div>
    </div>
  );
}

function CloseCall({ t }: { t: number }) {
  const x = CLOSE_CALL;
  const landed = t >= CLOSE_LANDS_AT + 2 * LAMP_GAP;
  const whites = x.lights.filter(l => l === 'white').length;
  return (
    <div className="scene-attempt">
      <LiftFigure lift={x.lift} />
      <div className="scene-side">
        <span className="hud-label">{liftLabel(x)}</span>
        <p className="scene-who">{`${x.name} · ${x.weight} lb`}</p>
        <Lamps states={lampsAt(t, CLOSE_LANDS_AT, x.lights, true)} size={44} bot />
        <p className="body scene-note" aria-live="polite">
          {t < CLOSE_LANDS_AT ? 'The referee bot is looking at this one' : landed ? `${whites} white lights and ${3 - whites} red: good lift.` : ' '}
        </p>
      </div>
    </div>
  );
}

function Desk({ t }: { t: number }) {
  const read = t >= READ_AT + 0.4;
  const offset = Math.max(0, t - ROLL_AT) * ROLL_PX_S;
  return (
    <DeskStage inert label="The host desk: Rosa M.'s read-out card, then the roll call">
      <DeskTop night="Sample meet · Meet night" count={totalsAt(t)} />
      <div className="desk-main">
        {!read ? (
          <>
            <ReadoutCard eyebrow="AGE-GROUP LEADERS" leaving={t >= READ_AT}
              r={{ id: ROSA.id, name: ROSA.name, sayIt: ROSA.sayIt, ageGroup: ROSA.ageGroup!, division: 'Barbell', hometown: ROSA.hometown, total: '290', units: 'lb', line: ROSA.line }} />
            <div className="desk-actions">
              <span className={`desk-read${t >= READ_AT ? ' pressed' : ''}`}>Read</span>
              <span className="desk-skip">Skip</span>
              <span className="desk-left">3 left in this list</span>
            </div>
          </>
        ) : (
          <p className="desk-said">Read out on the live</p>
        )}
      </div>
      <RollBand rows={[ROLL]} offset={offset} />
    </DeskStage>
  );
}

function Ending() {
  return (
    <div className="scene-end">
      <div className="scene-end-actions">
        <Link className="btn" href="/try">Try a lift</Link>
        <Link className="btn ghost" href="/join">Join the Winter meet</Link>
      </div>
      <p className="small">In a real meet, Soo&apos;s live plays here from YouTube.</p>
      <Link className="link" href="/host/sample">Try the host desk</Link>
    </div>
  );
}

function Scene({ t }: { t: number }) {
  if (t >= REPLAY_S) return <Ending />;
  const ch = chapterAt(t);
  if (ch === 0) {
    return (
      <div className="scene-open">
        <span className="eyebrow">THE PLATFORM IS OPEN</span>
        <span className="weight-m num">0</span>
        <span className="small">first totals so far</span>
      </div>
    );
  }
  if (ch === 1) return <Featured t={t} />;
  if (ch === 2) return t < CLOSE_AT - 0.5 ? <Featured t={FEATURED_AT[2] + 3} /> : <CloseCall t={t} />;
  if (ch === 3) return <Desk t={t} />;
  return (
    <div className="scene-card">
      <img src={SAMPLE_CARD} width={1080} height={1920} alt="Dana W.'s meet card: 50–59 · Barbell · 345 lb total · 9 for 9" />
    </div>
  );
}

export function SampleReplay() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [division, setDivision] = useState<Division>('barbell');
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    last.current = null;
    const step = (now: number) => {
      const dt = last.current == null ? 0 : (now - last.current) / 1000;
      last.current = now;
      setT(v => {
        const n = Math.min(REPLAY_S, v + dt);
        if (n >= REPLAY_S) setPlaying(false);
        return n;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const toggle = useCallback(() => {
    if (!playing && t >= REPLAY_S) setT(0);
    setPlaying(p => !p);
  }, [playing, t]);

  // the board and the ticker move on whole lights, so they redraw only when one lands
  const landedKey = Math.floor(t * 4);
  const lifters = useMemo(() => liftersAt(landedKey / 4), [landedKey]);
  const rows = useMemo(() => shownRows(boardRows(lifters, division, false), null), [lifters, division]);
  const ticker: TickerItem[] = useMemo(() => tickerAt(landedKey / 4).map(x => ({
    id: x.id, name: x.name, division: x.division, lift: x.lift, number: x.number, weight: x.weight, reps: x.reps, units: 'lb',
    lamps: x.id === CLOSE_CALL.id && landedKey / 4 < CLOSE_LANDS_AT ? ['pulse', 'pulse', 'pulse'] : x.lights,
  })), [landedKey]);
  const ch = chapterAt(t);

  return (
    <section className="replay" aria-label="The sample meet replay">
      <div className="scene">
        <Scene t={t} />
      </div>
      <div className="replay-bar">
        <button type="button" className="replay-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={22} weight="fill" /> : <Play size={22} weight="fill" />}
        </button>
        <div className="ref-scrub on-stage" style={{ ['--played' as string]: `${(t / REPLAY_S) * 100}%` }}>
          <input type="range" min={0} max={REPLAY_S} step={0.1} value={t} aria-label="Replay position"
            aria-valuetext={`${clock(t)} of ${clock(REPLAY_S)}, ${CHAPTERS[ch].label}`}
            onChange={e => setT(Number(e.currentTarget.value))} />
        </div>
        <span className="caption num replay-time">{`${clock(t)} / ${clock(REPLAY_S)}`}</span>
      </div>
      <ol className="chapters">
        {CHAPTERS.map((c, i) => (
          <li key={c.at}>
            <button type="button" className="eyebrow" aria-current={i === ch && t < REPLAY_S ? 'step' : undefined} onClick={() => setT(c.at)}>{c.label}</button>
          </li>
        ))}
      </ol>
      <div className="replay-live">
        <div>
          <h2 className="eyebrow">LATEST LIGHTS</h2>
          {ticker.length ? <Ticker items={ticker} /> : <p className="small">No lights yet.</p>}
        </div>
        <div>
          <div className="replay-board-head">
            <h2 className="eyebrow">THE BOARD</h2>
            <fieldset className="segments">
              <legend>Division</legend>
              {(['barbell', 'home'] as const).map(d => (
                <label key={d}><input type="radio" name="sample-division" checked={division === d} onChange={() => setDivision(d)} />{d === 'home' ? 'Home' : 'Barbell'}</label>
              ))}
            </fieldset>
          </div>
          <Board rows={rows} division={division} caption={`Sample meet board, ${division === 'home' ? 'Home' : 'Barbell'}`} />
        </div>
      </div>
    </section>
  );
}
