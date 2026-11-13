'use client';
// One meet attempt (plan 5.25, look 9 steps 1–11), any of the nine: the attempt card, the stage,
// the lift's own commands, the recording saved on the phone and sent to R2, the held breath while
// Render judges it, and the lights as they land. A sample lift (5.36) runs the same server path;
// the phone only plays the clip. What comes next (declaring, the next lift, the total) is the
// platform's: the panel's button calls `onNext`.
import Link from 'next/link';
import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { SpeakerHigh, SpeakerSlash, X } from '@phosphor-icons/react';
import { RULES, type Dims, type Part } from '@/lib/judge';
import { MeetLift, type MeetLiftName } from '@/lib/judge/meet-lift';
import { nearSide, type Pt } from '@/lib/judge/pose';
import { BAR_FRAME_H } from '@/lib/judge/plate-tracker';
import { smallWidth } from '@/lib/judge/bar-stage';
import { greyFrame, markSide, pathPieces, tapToFrame, tickAt } from '@/lib/stage/bar-marks';
import { Lamps, type LampState } from '@/components/lamps';
import { BarDiagram, BellDiagram } from '@/components/bar-diagram';
import { ReadyDock } from '@/components/ready-dock';
import { loadPoseModel, LivePose } from '@/lib/stage/pose-live';
import { Voice, type VoiceKey } from '@/lib/stage/voice';
import { thock, audio } from '@/lib/stage/thock';
import { DeepestFrames, liftMarks, type LiftMarks, type Snap } from '@/lib/stage/snap';
import { Recording, readyToSeek, seekTo, sleep, within } from '@/lib/stage/recorder';
import { heldFrameMs } from '@/lib/stage/held-frame';
import { STAGE_WORDS } from '@/lib/stage/try-words';
import {
  COMMAND_TEXT, MEET_WORDS, REFUSED_WORDS, hudLine, liftCaps, liftCommands, loadingLine, meetResult, nextButton, noRepLine, sampleRepsLine,
  setupLine, spotLineShown, standInLine, weightDigits, WINDOW_WORDS, type MeetResult,
} from '@/lib/stage/meet-words';
import { WindowText } from '@/components/window-words';
import { keepSending, getPending, savePending, type UploadStatus } from '@/lib/stage/uploader';
import { apiFetch, phoneNow } from '@/lib/stage/server-clock';
import samples from '../../content/samples/samples.json';
import { WaitLine } from '@/components/wait-line';
import { useLand } from '@/lib/stage/land';
import { LiftIcon } from '@/components/chrome';
import { frameTurn, ORIENT_WORDS, screenTurn, wayFor, type Quarter } from '@/lib/stage/orient';
import { useOrientation } from '@/lib/stage/use-gravity';
import { useDrawnTurn } from '@/lib/stage/drawn-turn';
import { useLinger } from '@/lib/stage/linger';
import { FrameTurner } from '@/lib/stage/frame-turn';

export type MeetAttemptProps = {
  attempt: { id: string; lift: string; number: number; weight: number; reps_declared: number | null; status: string; kind?: 'pair' | 'bell' | null };
  lifter: { cardName: string; ageGroup: string | null; division: 'barbell' | 'home'; units: 'lb' | 'kg' };
  /** The because line (5.25 step 1), worked out on the server. */
  because: string;
  voicePack: string;
  /**
   * The panel's button (5.25 step 11): "Declare your next attempt", "Next: <lift>" or "See your
   * total". It shows once the lights are in, and from 90 s or on a close call (step 8), while she waits.
   */
  onNext?: () => void;
  /** The panel button's words, when the platform knows better (the banner's attempt: "Back to the platform"). */
  nextLabel?: string;
  /** The panel button as a Ghost ("Back to the platform", 5.27, item 76). */
  nextGhost?: boolean;
  /** Above the attempt card: the platform's eyebrow and the 9-attempt row (5.24). */
  top?: React.ReactNode;
  /** No judged set behind the cap yet: the `NOT JUDGED YET` tag beside the weight (look 5.6). */
  notJudged?: boolean;
  /** The demo meet (5.36): "Use a sample lift instead", and the close call's "Be the referee". A real meet's lifts are filmed and its close calls wait for a real referee. */
  demoReferee?: boolean;
  /** Under the links ("Test your spot first"), during flight time: "Your flight is lifting" (5.24, look 5.8, item 81). */
  strip?: React.ReactNode;
  /**
   * Item 80 (look 5.10, "Never while she lifts"): true from "I'm ready" until her result panel has
   * settled (its 480 ms slide-in has ended), so the platform holds every banner while she may be under a bar.
   */
  onBusy?: (busy: boolean) => void;
  /**
   * Item 85 (3.8, 3.11): when the platform closes. From then, "I'm ready" starts nothing: the attempt
   * is `void` (`after_close`) and she sees "The platform has closed". Checked by the phone's clock,
   * corrected by our server's (item 86). Null: it never closes (the demo).
   */
  closesAt?: string | null;
  /** Item 85: she has a judged lift, so the closed sheet's button is "See your total" (else "OK", to the closed page). */
  anyJudged?: boolean;
};

/** The meet window's sheet (3.11, item 85): why this attempt isn't judged. */
type WindowStop = { reason: 'after_close' | 'upload_late'; closesAt: string | null; deadline: string | null };

type View = 'card' | 'stage' | 'denied' | 'nocamera' | 'limit' | 'window' | 'motion';
/** `refilm`: the bench filmed again after "We lost the bar" (3.4b), straight to the tap. */
type Mode = 'lift' | 'spot' | 'sample' | 'resume' | 'refilm';
type Phase = 'loading' | 'spot' | 'good-spot' | 'tap' | 'spot-done' | 'loaded' | 'lifting' | 'norep' | 'void' | 'held' | 'lit' | 'close' | 'replay' | 'hold' | 'offline' | 'refused';
/** The bench's words over the stage (look 5.14c): the tap ask, or the bar lost on the hooks. */
type TapWords = { which: 'tap' | 'lost'; on: boolean } | null;
/** The bar mark (look 5.14c): where it sits (fractions of the camera frame), the template's size, and its lock-on count. */
type BarMark = { x: number; y: number; size: number; n: number; on: boolean };
/** Her bench clip's marks (look 5.14c): the plate's path in pieces (broken where it was lost), and the "Press!" tick. */
type BenchPath = { pieces: { x: number; y: number }[][]; press: { x: number; y: number } | null };
type Command = { text: string; kind: 'soft' | 'on' } | null;
type State = { status: string; shown_lift?: string; call: 'white' | 'red' | 'close' | null; lights: ('white' | 'red')[] | null; reason: string | null; red_rep: number | null; reps_declared: number | null; wait_minutes: number | null; judging?: 'normal' | 'busy' | 'paused' | null; judged_frame_ms?: number | null; sample?: boolean; sample_clip?: { credit: string; reps: number } | null };
type SampleClip = { id: string; file: string; credit: string; judged_frame_ms?: number; meet?: { reps: number; command_times: Record<string, number> } };

const PARTS: Part[] = ['head', 'hips', 'knees', 'feet'];
const NO_PARTS: Record<Part, boolean> = { head: false, hips: false, knees: false, feet: false };
/** "Bar is loaded." is held for 1.5 s on a sample's first frame (look 9 step 4). */
const SOFT_HOLD_MS = 1500;
/** On a sample, the spot segments light one by one, this far apart (look 9 step 3; as on /try). */
const PART_STEP_MS = 180;
/** Recording stops this long after "Rack!" (3.10). */
const AFTER_RACK_MS = 1500;
/** A Home set is cut off at 90 s (3.10). */
const HOME_CAP_MS = 90_000;
const SENDING_MIN_MS = 1300;
const SLOW_UPLOAD_MS = 20_000;
const POLL_MS = 5000;
const BUSY_REFRESH_MS = 30_000;

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Look's waits. Motion off drops the movement, never the reading time, so they stay as they are. */
const wait = (ms: number) => sleep(ms);
/** how often the 1.5 s after "Rack!" looks for a turn (3.10) */
const TURN_POLL_MS = 50;
/** the screen is wider than tall, read now (not on the next render) */
const screenSideNow = () => typeof matchMedia === 'function' && matchMedia('(orientation: landscape)').matches;
const asLift = (l: string): MeetLiftName => (l === 'bench' || l === 'deadlift' ? l : 'squat');

function containBox(stage: { w: number; h: number }, d: Dims | null) {
  if (!d || !stage.w || !stage.h) return { left: 0, top: 0, width: stage.w, height: stage.h };
  const k = Math.min(stage.w / d.w, stage.h / d.h);
  const width = d.w * k, height = d.h * k;
  return { left: (stage.w - width) / 2, top: (stage.h - height) / 2, width, height };
}

async function getJson(path: string, init?: RequestInit) {
  const r = await apiFetch(path, init);
  return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
}

export function MeetAttempt({ attempt, lifter, because, voicePack, onNext, nextLabel: nextLabelProp, nextGhost = false, top, notJudged, demoReferee = false, strip, onBusy, closesAt = null, anyJudged = false }: MeetAttemptProps) {
  const [win, setWin] = useState<WindowStop | null>(null);
  // "Use a sample lift instead" is the demo meet's only (5.36): a real meet's lifts are filmed
  const demo = demoReferee;
  const first = attempt;
  const home = lifter.division === 'home';
  const startView: View = first.status === 'declared' ? 'card' : 'stage';
  const [view, setView] = useState<View>(startView);
  const [mode, setMode] = useState<Mode>(startView === 'stage' ? 'resume' : 'lift');
  const [sound, setSound] = useState(true);
  const [limit, setLimit] = useState<'lifter' | 'everyone'>('lifter');

  // a decided attempt opens settled (item 91): never the held breath again
  const landScreen = useLand();
  const [phase, setPhase] = useState<Phase>(startView === 'stage' ? (first.status === 'judged' ? 'hold' : 'held') : 'loading');
  const [slow, setSlow] = useState(false);
  const [parts, setParts] = useState<Record<Part, boolean>>(NO_PARTS);
  const [line, setLine] = useState<string | null>(null);
  const [command, setCommand] = useState<Command>(null);
  const [recSec, setRecSec] = useState(0);
  const [recOn, setRecOn] = useState(false);
  const [reps, setReps] = useState(0);
  const [lamps, setLamps] = useState<LampState[]>(['off', 'off', 'off']);
  const [waitLine, setWaitLine] = useState('');
  const [busy, setBusy] = useState(false);
  const [slowUpload, setSlowUpload] = useState(false);
  const [spill, setSpill] = useState<'' | 'white' | 'red'>('');
  const [result, setResult] = useState<MeetResult | null>(null);
  const [resultOn, setResultOn] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [marks, setMarks] = useState<LiftMarks | null>(null);
  /** The lift the judge ran: a squat sample can stand in for another lift (5.36). */
  const [shownLift, setShownLift] = useState(attempt.lift);
  const [replaying, setReplaying] = useState(false);
  const [dims, setDims] = useState<Dims | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [sample, setSample] = useState<{ credit: string; reps: number } | null>(null);
  /** Reopened on a sample's attempt (a reload, "Back to the platform"): it keeps its SAMPLE LIFT box and credit. */
  const [resumedSample, setResumedSample] = useState(false);
  /** Reopened on a decided attempt: the lamps lit with no bloom and no thock, the result up at once (item 91). */
  const [settledOpen, setSettledOpen] = useState(false);
  const [error, setError] = useState('');
  // The Barbell bench (3.4b, look 5.14c): it follows the bar, and a referee gives every light.
  const bench = attempt.lift === 'bench' && !home;
  const [tapWords, setTapWords] = useState<TapWords>(null);
  const [barMark, setBarMark] = useState<BarMark | null>(null);
  const [benchPath, setBenchPath] = useState<BenchPath | null>(null);
  // Which way the phone stands (3.10, look 4a and 4b): the bench on its side, everything else tall
  const orient = useOrientation();
  const orientRef = useRef(orient);
  orientRef.current = orient;
  const needWay = wayFor(attempt.lift, lifter.division);
  /** the turning phone at Find your spot, while the phone faces the wrong way for this lift */
  const [turnShown, setTurnShown] = useState(false);
  // once the turning phone has shown, what it gives way to fades in over 200 ms (look 4a)
  const [turnedOnce, setTurnedOnce] = useState(false);
  if (turnShown && !turnedOnce) setTurnedOnce(true);
  /** which void sheet: the bench's lost bar (3.4b) or a phone that turned during the lift (3.10) */
  const [voidWhy, setVoidWhy] = useState<'bar' | 'turned'>('bar');
  /** the motion step (look 4b) waits for her answer, then films this */
  const [askFor, setAskFor] = useState<Mode | null>(null);
  // Look 4b: rotation lock kept the screen portrait while gravity says the phone is on its side, so the page
  // draws look 4a's landscape itself. It settles from "Bar is loaded." until the result is in.
  const sideways = orient.quarter === 90 || orient.quarter === -90;
  const wantTurn = view === 'stage' && orient.touch && !orient.screenSide && sideways ? screenTurn(orient.quarter!) : 0;
  const drawn = useDrawnTurn(wantTurn, view === 'stage' && (phase === 'loaded' || phase === 'lifting' || phase === 'held'));
  const land = landScreen || drawn !== 0;
  // look 4a (item 93): the turning phone fades out over 200 ms; the segments and the set-up line wait for it
  // F-G: also while the pose model loads ('loading'), from the camera's first frame
  const turnUp = useLinger(turnShown && (phase === 'loading' || phase === 'spot' || phase === 'good-spot' || phase === 'tap'), 200);

  const stageRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLVideoElement>(null);
  const replayRef = useRef<HTMLVideoElement>(null);
  const frozenRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** look 4b: the camera frames turned upright before anything sees them, when rotation lock is on */
  const turnerRef = useRef<FrameTurner | null>(null);
  const voiceRef = useRef<Voice | null>(null);
  const runRef = useRef(0);
  /** She tapped "OK" on the offline sheet: it stays closed while the clip keeps trying (3.11). */
  const offlineOkRef = useRef(false);
  const waitLineRef = useRef<HTMLDivElement>(null);
  const soundRef = useRef(sound);
  const footageRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  // an alert dialog takes focus when it opens, so a screen reader lands in the void sheet (The Playner, 13 Nov)
  const voidRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (phase === 'void') voidRef.current?.focus(); }, [phase]);
  /** The bench's tap, while the bar stage takes one (set by runCamera). */
  const tapRef = useRef<((x: number, y: number) => void) | null>(null);

  voiceRef.current ??= new Voice(voicePack);
  useEffect(() => { voiceRef.current!.on = sound; soundRef.current = sound; }, [sound]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStageSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  const stopCamera = useCallback(() => {
    turnerRef.current?.stop();
    turnerRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => () => { runRef.current++; stopCamera(); }, [stopCamera]);

  const resetStage = () => {
    setPhase('loading'); setSlow(false); setParts(NO_PARTS); setLine(null); setCommand(null); setRecOn(false); setReps(0);
    setLamps(['off', 'off', 'off']); setWaitLine(''); setBusy(false); setSlowUpload(false); setSpill(''); setResult(null); setResultOn(false);
    setFrozen(false); setMarks(null); setReplaying(false); setSample(null); setError(''); setShownLift(attempt.lift);
    setResumedSample(false); setSettledOpen(false);
    setTapWords(null); setBarMark(null); setBenchPath(null); tapRef.current = null;
    setTurnShown(false); setVoidWhy('bar');
  };

  /** Freezes the stage on the judged moment: the deepest frame the phone saw. */
  const freeze = (snap: Snap | null) => {
    const fc = frozenRef.current;
    if (!snap || !fc) return null;
    fc.width = snap.canvas.width; fc.height = snap.canvas.height;
    fc.getContext('2d')!.drawImage(snap.canvas, 0, 0);
    setFrozen(true);
    return snap;
  };

  /**
   * The held breath and the lights (5.25 steps 8–9): "Sending to the judges" for at least 1.3 s,
   * then "The judges are looking"; 45 s and 90 s lines; the lights from the live stream (with a
   * 5 s poll behind it), lit 330 ms apart. A close call waits, pulsing, for the referee's lights.
   */
  const awaitLights = useCallback(async (alive: () => boolean, attemptId: string, sent: Promise<boolean>, snap: SideSnap | null, replay: (keepPhase?: boolean) => Promise<void>, snapAt?: (ms: number) => Promise<SideSnap | null>, path?: BenchPath | null, closeNow = false) => {
    const t0 = performance.now();
    // F-E: a reload of a close call already open, settled (closeNow): no "Sending", no looking wait, no
    // 45 s or 90 s lines; it waits, pulsing, for the referee's lights
    let lookingAt = closeNow ? -Infinity : t0;
    if (!closeNow) {
    // every Barbell bench goes to a referee (3.4b, look 5.14c): "Sending to the referee", with no panel
    setPhase('held'); setCommand(null); setWaitLine(bench ? MEET_WORDS.bench.sending : MEET_WORDS.sending);
    const ok = await sent;
    if (!ok || !alive()) return;
    await sleep(Math.max(0, SENDING_MIN_MS - (performance.now() - t0)));
    if (!alive()) return;
    lookingAt = performance.now();
    if (bench) {
      // once it's sent: the close call's pulse and line, and "To a referee" in the panel, with no
      // thock, spill or total drop (nothing was judged). Then her clip: the last 2 s, and the
      // "Press!" frame held with the bar's path.
      setLamps(['pulse', 'pulse', 'pulse']); setWaitLine(MEET_WORDS.bench.looking);
      setResult(meetResult({ call: 'close', lights: null, reason: 'bench_referee', red_rep: null, reps_declared: null, lift: attempt.lift }));
      setPhase('close'); setResultOn(true);
      await wait(900);
      if (!alive()) return;
      if (!reduced()) { await replay(true).catch(() => {}); if (!alive()) return; }
      setReplaying(false);
      if (snap) freeze(snap);
      setBenchPath(path ?? null);
    } else setWaitLine(MEET_WORDS.looking);
    }

    let state: State | null = null;
    let wake: (() => void) | null = null;
    const check = async (withWait = false) => {
      const r = await getJson(`/api/attempts/${attemptId}${withWait ? '?wait=1' : ''}`).catch(() => null);
      // the route answers with the attempt's state itself, not wrapped
      if (r?.status === 200) { state = r.body as unknown as State; wake?.(); }
    };
    const es = typeof EventSource !== 'undefined' ? new EventSource(`/api/live?attempt=${attemptId}`) : null;
    es?.addEventListener('attempt', () => void check());
    const poll = setInterval(() => void check(), POLL_MS);
    // the bench's line is the referee's from the upload on: no 45 s or 90 s lines (look 5.14c)
    const t45 = bench || closeNow ? undefined : setTimeout(() => alive() && setWaitLine(MEET_WORDS.still45), Math.max(0, 45_000 - (performance.now() - t0)));
    // from 90 s, the estimate (3.9 step 8) is asked again every 30 s, and once she has waited
    // past what it said, it goes up a minute: it never says "about 1 minute" for 3
    let shown = 0, dueAt = 0, every: ReturnType<typeof setInterval> | undefined;
    const estimate = async () => {
      await check(true);
      if (!alive()) return;
      // item 87: paused (3.9 step 9) says so, with no minutes; once it un-pauses, a fresh estimate
      if ((state as State | null)?.judging === 'paused') { shown = 0; setWaitLine(MEET_WORDS.paused90); setBusy(true); return; }
      const n0 = (state as State | null)?.wait_minutes;
      if (!n0) return;
      const n = shown && performance.now() > dueAt ? Math.max(n0, shown + 1) : n0;
      if (n !== shown) { shown = n; dueAt = performance.now() + n * 60_000; }
      setWaitLine(MEET_WORDS.busy90(shown)); setBusy(true);
    };
    const t90 = bench || closeNow ? undefined : setTimeout(() => { void estimate(); every = setInterval(() => void estimate(), BUSY_REFRESH_MS); },
      Math.max(0, 90_000 - (performance.now() - t0)));
    const stop = () => { es?.close(); clearInterval(poll); clearTimeout(t45); clearTimeout(t90); clearInterval(every); };
    const next = () => new Promise<void>(res => { wake = res; });

    try {
      await check();
      let pulsing = closeNow;
      for (;;) {
        if (!alive()) return;
        const s = state as State | null;
        if (s?.call === 'close' && !pulsing && !bench) {
          pulsing = true;
          await sleep(Math.max(0, RULES.tryALift.judgeLookingMinMs - (performance.now() - lookingAt)));
          if (!alive()) return;
          clearTimeout(t45); clearTimeout(t90); clearInterval(every);
          setLamps(['pulse', 'pulse', 'pulse']); setWaitLine('A referee is looking at this one');
          const shownC = s.shown_lift ?? attempt.lift;
          setShownLift(shownC);
          setResult(meetResult({ ...s, lift: attempt.lift })); setPhase('close'); setResultOn(true);
          // look step 10 (LookieBot 1): while a referee looks, the stage holds the judged frame with its marks,
          // as after the lights: the server's judged moment when it says which, else the phone's own
          let judged = snap;
          if (snapAt && typeof s.judged_frame_ms === 'number') judged = (await snapAt(s.judged_frame_ms).catch(() => null)) ?? snap;
          if (!alive()) return;
          setFrozen(!!freeze(judged));
          if (judged?.p.length) setMarks(liftMarks(shownC, judged.p, { w: judged.canvas.width, h: judged.canvas.height }, judged.side));
        }
        if (s && (s.call === 'white' || s.call === 'red')) break;
        await next();
      }
      stop();
      // a fast judge still lets "The judges are looking" finish its crossfade and be read (look 8)
      await sleep(Math.max(0, RULES.tryALift.judgeLookingMinMs - (performance.now() - lookingAt)));
      if (!alive()) return;
      const s = state as unknown as State;
      const res = meetResult({ ...s, lift: attempt.lift })!;
      const shown = s.shown_lift ?? attempt.lift;
      setShownLift(shown);
      // a close call that opened settled lights its lamps, spill and result as any other (F-E); its
      // judged frame keeps its marks, which turn from grey to the lights' colour (look step 10, plan 5.27)
      setSettledOpen(false);
      setResult(res); setResultOn(false); setWaitLine(''); setBusy(false);
      // the lights: left, head, right, 330 ms apart, then the spill, then the result 420 ms later
      setPhase('lit');
      for (let k = 0; k < 3; k++) {
        setLamps(res.lamps.map((l, j) => (j <= k ? l : 'off')));
        if (soundRef.current) thock(res.lamps[k] === 'red');
        if (k < 2) await wait(330);
        if (!alive()) return;
      }
      setSpill(s.call === 'white' ? 'white' : 'red');
      await wait(420);
      if (!alive()) return;
      setResultOn(true);
      // her clip (step 10): the last 2 s in real time, then the judged frame with the marks
      await wait(900);
      if (!alive()) return;
      // the 2 s replay plays without marks (each replay clears them as it starts); they come back on the
      // judged frame after it. A reload has no clip to replay, so its marks stay up until the judged frame's
      // redraw replaces them, with no blink (NerdCider's note on 1b78e8e)
      if (!reduced()) { await replay().catch(() => {}); if (!alive()) return; }
      setReplaying(false);
      // a sample's frozen frame is the server's judged moment, when it says which
      let judged = snap;
      if (snapAt && typeof s.judged_frame_ms === 'number') judged = (await snapAt(s.judged_frame_ms).catch(() => null)) ?? snap;
      if (!alive()) return;
      setFrozen(!!freeze(judged));
      if (judged?.p.length) setMarks(liftMarks(shown, judged.p, { w: judged.canvas.width, h: judged.canvas.height }, judged.side));
      // the bench keeps the bar's path on its "Press!" frame (look 5.14c)
      if (bench && path) setBenchPath(path);
      setPhase('hold');
    } finally { stop(); }
  }, [attempt.lift, bench]);

  /** Sends the saved recording, telling the stage how it goes; resolves once the server has it. */
  const send = useCallback((alive: () => boolean, attemptId: string) => {
    const started = performance.now();
    offlineOkRef.current = false;
    const slowT = setTimeout(() => alive() && setSlowUpload(true), SLOW_UPLOAD_MS);
    return new Promise<boolean>(resolve => {
      const onStatus = (s: UploadStatus) => {
        if (!alive()) return;
        if (s.kind === 'offline') { if (!offlineOkRef.current) setPhase('offline'); }
        else if (s.kind === 'sending' || s.kind === 'retrying') setPhase(p => (p === 'offline' ? 'held' : p));
      };
      void keepSending(attemptId, onStatus).done.then(s => {
        clearTimeout(slowT);
        if (!alive()) return resolve(false);
        setSlowUpload(false);
        if (s.kind === 'sent') { setPhase('held'); return resolve(true); }
        if (s.kind === 'limit') { setLimit(s.limit); setView('limit'); return resolve(false); }
        // 3.11 (item 85): after the close, or past the clip deadline. Not judged; her clip is gone from the phone.
        if (s.kind === 'window') { stopCamera(); setWin({ reason: s.reason, closesAt: s.closesAt, deadline: s.deadline }); setView('window'); return resolve(false); }
        if (s.kind === 'refused') console.warn('upload refused', s.error);
        setPhase('refused'); resolve(false);
      });
      void started;
    });
  }, [stopCamera]);

  /** Her own lift, or "Test your spot first" (the frame check alone, 5.23). */
  const runCamera = useCallback(async (spotOnly: boolean, atTap = false): Promise<void> => {
    const my = ++runRef.current;
    const alive = () => runRef.current === my;
    const voice = voiceRef.current!;
    const video = feedRef.current!;
    if (!streamRef.current) {
      if (!navigator.mediaDevices?.getUserMedia) { setView('nocamera'); return; }
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } }, audio: false });
      } catch (e) {
        const name = (e as DOMException).name;
        setView(name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' ? 'nocamera' : 'denied');
        return;
      }
    }
    if (!alive()) return;
    turnerRef.current?.stop();
    turnerRef.current = null;
    setTurnShown(false);
    const playFrom = async (src: MediaStream) => {
      video.removeAttribute('src');
      video.srcObject = src;
      video.muted = true; video.playsInline = true;
      if (video.readyState < 2) await new Promise(r => video.addEventListener('loadeddata', r, { once: true }));
      await video.play().catch(() => {});
    };
    await playFrom(streamRef.current);
    if (!alive()) return;
    // the camera's own frames, before any turn
    const raw: Dims = { w: video.videoWidth, h: video.videoHeight };
    // look 4b: a phone on its side whose screen didn't turn still gets portrait frames: turn them upright,
    // so the judge, the grey frames, the frozen frame and the recording all see her standing (or lying) right
    const turnNow = frameTurn(orientRef.current.watch.quarter, raw.w, raw.h);
    if (turnNow) {
      turnerRef.current = new FrameTurner(streamRef.current, turnNow, raw.w, raw.h);
      await playFrom(turnerRef.current.stream);
      if (!alive()) return;
    }
    const filmed = turnerRef.current?.stream ?? streamRef.current;
    const d: Dims = turnNow ? { w: raw.h, h: raw.w } : raw;
    setDims(d);
    /** the camera's frames now: a screen that turns changes their shape */
    const rawNow = (): Dims => {
      const t = turnerRef.current;
      return t ? t.rawDims : { w: video.videoWidth, h: video.videoHeight };
    };

    const slowTimer = setTimeout(() => alive() && setSlow(true), 4000);
    // 3.10, item 93: the turning phone shows once the camera is on, not once the pose model is ready. While
    // the model loads, the drawing follows which way the phone faces; the frame check takes over after.
    let modelIn = false, preUp = false;
    const preTurn = () => {
      if (!alive() || modelIn) return;
      const o = orientRef.current;
      const wrong = o.way !== null && o.way !== needWay;
      if (wrong !== preUp) { preUp = wrong; setTurnShown(wrong); }
      requestAnimationFrame(preTurn);
    };
    requestAnimationFrame(preTurn);
    let pose: LivePose;
    try { pose = new LivePose(await loadPoseModel()); } catch { modelIn = true; clearTimeout(slowTimer); if (alive()) setSlow(true); return; }
    modelIn = true;
    clearTimeout(slowTimer);
    if (!alive()) return;
    setSlow(false);

    const lift = asLift(attempt.lift);
    const ml = new MeetLift(d, lift, { reps: home ? attempt.reps_declared ?? 1 : null, atTap });
    // 5.25 step 3 (item 89): the set-up line first, until the frame check sees her
    const setup = setupLine(lift, lifter.division);
    let seenYet = false;
    // "Film again" after the bench's void (look 5.14c) goes back to the tap, with its words as at the start
    if (atTap) { setPhase('tap'); setTapWords({ which: 'tap', on: true }); }
    else { setPhase('spot'); setLine(setup); }
    // The bench's grey frames (3.4b): BAR_FRAME_H tall, the camera frame's shape
    const gc = document.createElement('canvas');
    const gw = smallWidth(d.w, d.h, BAR_FRAME_H);
    const grey = () => greyFrame(video, gc, gw, BAR_FRAME_H);
    let pressSnap: SideSnap | null = null, voidSnap: SideSnap | null = null, voided = false, marks = 0;
    const extras: Record<string, unknown> = {};
    // the bar mark follows the plate every frame with no easing (look 5.14c): set on the element, not in state
    const placeMark = (x: number, y: number) => {
      const el = markRef.current;
      if (el) { el.style.left = `${(1 - x) * 100}%`; el.style.top = `${y * 100}%`; }
    };
    const endWord = liftCommands(lift, lifter.division).end;
    const deepest = new DeepestFrames(d);
    const recording = new Recording(home ? 1_500_000 : 2_500_000);
    const ct: Record<string, number> = {};
    const t0 = performance.now();
    let lastMedia = -1, recTimer: ReturnType<typeof setInterval> | null = null, liftAt = 0, endAt = 0, noRep = false, spotDone = false;
    // command_times and the 1.5 s after "Rack!" run from the frame that earned each command
    // (plan 3.4 piece 2, 3.10), not from after the pose model has run on it
    const since = (frameAt: number) => Math.round(frameAt - recording.startedAt);
    // REC and its timer run from her start command; the deadlift has none, so from "Bar is loaded."
    const startRec = (at: number) => {
      if (liftAt) return;
      liftAt = at;
      flushSync(() => { setPhase('lifting'); setRecSec(0); setRecOn(true); });
      recTimer = setInterval(() => setRecSec(Math.floor((performance.now() - at) / 1000)), 250);
    };
    const show = (text: string) => flushSync(() => setCommand({ text, kind: 'on' }));
    const softCommand = () => {
      setCommand({ text: home ? MEET_WORDS.soft.home : MEET_WORDS.soft.barbell, kind: 'soft' });
      voice.say(home ? 'weights-ready' : 'bar-loaded');
    };
    // her tap (look 5.14c): wherever she taps on the camera view is the point; a second tap before
    // "Start!" moves the mark. The footage is mirrored on screen, the frame is not.
    tapRef.current = (cx, cy) => {
      if (!alive() || !ml.wantsBar || ml.phase === 'lifting') return;
      const el = footageRef.current;
      const g = el && grey();
      if (!el || !g) return;
      // in the stage's own px (the tap target fills the stage), so it holds when the page is drawn turned (4b)
      const p = tapToFrame({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }, cx, cy, true);
      const again = ml.phase === 'loaded';
      if (!ml.tapBar(g, p.x, p.y)) return;
      flushSync(() => { setTapWords(w => w && { ...w, on: false }); setBarMark({ x: p.x, y: p.y, size: ml.plateTap?.size ?? 0.08, n: ++marks, on: true }); });
      placeMark(p.x, p.y);
      // a re-tap after the bar was lost on the hooks: "Bar is loaded." again (3.4b)
      if (again && lostOnHooks) { lostOnHooks = false; softCommand(); }
    };
    let lostOnHooks = false;
    // 3.10: the frame check doesn't pass while the phone faces the wrong way for this lift. With gravity it
    // waits for the turn, and the turning phone comes back if she turns it wrong again before "Bar is
    // loaded.". With only the screen to go by (no sensor, or "Not now"), the drawing keeps its rotation-lock
    // line and gives way once the frame check sees her, as the set-up line does: she can go on (look 4b).
    let turnUp = preUp, turnGone = false, loaded = false, turned = false;
    let settled: Quarter | null = null;
    /** with no gravity at "Bar is loaded." (no sensor, or "Not now"): the screen's shape then, on a touch phone */
    let screenAt: boolean | null = null;
    let turnSnap: SideSnap | null = null;
    /**
     * 3.10: from "Bar is loaded." until the recording ends, has the phone turned? Gravity past 60° for 500 ms
     * when there is gravity; with none, the screen turning (a touch phone only: a desktop window never turns).
     */
    const turnedSinceLoaded = () => {
      if (!loaded) return false;
      if (settled !== null) return orientRef.current.watch.quarter !== settled;
      return screenAt !== null && screenSideNow() !== screenAt;
    };
    /** before "Bar is loaded.", the phone turned so the frames need turning another way (or the screen
     * turned and changed their shape): the frame check starts again on the new frames */
    let reTurn = false;

    await new Promise<void>(resolve => {
      const done = () => { if (recTimer) clearInterval(recTimer); resolve(); };
      const tick = () => {
        if (!alive()) return done();
        const now = performance.now();
        if (video.currentTime === lastMedia) return void requestAnimationFrame(tick);
        lastMedia = video.currentTime;
        const o = orientRef.current;
        if (!loaded) {
          const r = rawNow();
          if (r.w && r.h && (frameTurn(o.watch.quarter, r.w, r.h) !== turnNow || (r.w > r.h) !== (raw.w > raw.h))) { reTurn = true; return done(); }
        }
        if (!loaded && !turnGone) {
          const wrong = o.way !== null && o.way !== needWay;
          if (wrong !== turnUp) { turnUp = wrong; setTurnShown(wrong); }
          if (wrong && o.quarter !== null) return void requestAnimationFrame(tick);
          if (wrong && seenYet) { turnGone = true; turnUp = false; setTurnShown(false); }
        }
        // a phone that turns during the attempt (gravity past 60° for 500 ms, from "Bar is loaded." on) is
        // void, never judged: "Your phone turned during the lift" (3.10)
        if (turnedSinceLoaded()) {
          turned = true; turnSnap = grab(video, d);
          // item 93: the end word at once, even before the start command: a squat or bench may already be
          // out of the rack
          show(endWord); voice.say(lift === 'deadlift' ? 'down' : 'rack');
          return done();
        }
        let evs;
        if (ml.wantsBar) {
          // the bench follows the bar from the tap (3.4b): grey frames, no pose run
          const g = grey();
          evs = g ? ml.feedBar(g, now - t0) : [];
        } else {
          const f = { t: now - t0, p: pose.detect(video) };
          // the squat's held frame is its deepest; other lifts hold their last frame
          if (lift === 'squat' && liftAt) deepest.offer(f, video);
          evs = ml.feed(f);
          seenYet ||= f.p !== null;
        }
        for (const ev of evs) {
          if (ev.type === 'spot') { setParts(cur => (PARTS.every(k => cur[k] === ev.spot.parts[k]) ? cur : ev.spot.parts)); setLine(spotLineShown(setup, seenYet, ev.spot.line)); }
          else if (ev.type === 'good-spot') {
            setPhase('good-spot'); setLine(null); setParts({ head: true, hips: true, knees: true, feet: true });
            setCommand({ text: STAGE_WORDS.goodSpot, kind: 'soft' }); voice.say('good-spot');
            if (spotOnly) { spotDone = true; return done(); }
          } else if (ev.type === 'tap-ask') {
            // the bench (3.4b): "Tap the end of the bar on your screen." once "Good spot." has held
            setPhase('tap'); setCommand(null); setLine(null); setTapWords({ which: 'tap', on: true });
          } else if (ev.type === 'mark') {
            placeMark(ev.x, ev.y);
          } else if (ev.type === 'lost') {
            // lost on the hooks before "Start!": the mark goes, the words and the voice together
            lostOnHooks = true;
            setBarMark(m => m && { ...m, on: false }); setCommand(null); setTapWords({ which: 'lost', on: true }); voice.say('lost-bar');
          } else if (ev.type === 'loaded') {
            // 5.25 step 4: the soft command; the recording starts here, so it is 0 in command_times
            setPhase('loaded'); softCommand();
            loaded = true; settled = o.watch.quarter;
            screenAt = settled === null && o.touch ? screenSideNow() : null;
            if (turnUp) { turnUp = false; setTurnShown(false); }
            recording.start(filmed);
            ct.loaded = 0;
            if (lift === 'deadlift') startRec(now);
          } else if (ev.type === 'call') {
            ct[ev.key] = since(now);
            if (ev.word !== 'press') startRec(now);
            // the bench: the mark goes at "Start!"; her clip holds on the "Press!" frame (look 5.14c)
            if (ml.byBar && ev.word === 'start') setBarMark(m => m && { ...m, on: false });
            if (ml.byBar && ev.word === 'press' && !pressSnap) pressSnap = grab(video, d);
            if (ev.why) extras.press_late_why = ev.why;
            show(COMMAND_TEXT[ev.word]); voice.say(ev.word);
          } else if (ev.type === 'rep') {
            ct[ev.key] = since(now); setReps(ev.k);
            // a Home deadlift says "Down!" after each rep (3.8a); the others count softly
            if (ev.down) { show(COMMAND_TEXT.down); voice.say('down'); }
            else if (ev.k <= 20) voice.say(`count-${ev.k}` as VoiceKey);
          } else if (ev.type === 'end') {
            endAt = now; ct[ev.key] = since(now); noRep = ev.noRep;
            // no "Start!" out of the rack (3.4b): "Rack!", then the void sheet, frozen on this frame
            if (ev.void) { voided = true; voidSnap = grab(video, d); }
            show(endWord); voice.say(ev.key);
            return done();
          }
        }
        if (home && liftAt && now - liftAt > HOME_CAP_MS) {
          // 90 s is the most a Home set can run: the end command now, on what was seen
          const key = lift === 'deadlift' ? 'down' : 'rack';
          endAt = now; ct[key] = since(now);
          show(endWord); voice.say(key);
          return done();
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (!alive()) return;
    tapRef.current = null;
    if (reTurn) { await runCameraRef.current?.(spotOnly, atTap); return; }
    if (spotDone) {
      await wait(900);
      if (!alive()) return;
      stopCamera(); setCommand(null); setPhase('spot-done');
      return;
    }
    // 3.10: recording stops 1.5 s after "Rack!" / "Down!". The phone has to stay the way it lay until then:
    // a turn in those 1.5 s voids it too ("RACK!" or "DOWN!" has already been called).
    if (!turned && !voided) {
      const until = endAt + AFTER_RACK_MS;
      while (performance.now() < until) {
        if (!alive()) return;
        if (turnedSinceLoaded()) { turned = true; turnSnap = grab(video, d); break; }
        await sleep(Math.min(TURN_POLL_MS, Math.max(0, until - performance.now())));
      }
    }
    if (turned) {
      // 3.10: nothing was judged and nothing is kept. "Rack!" (or "Down!") ran first, so she is never left
      // holding the bar with no command; then the sheet, frozen on the turn.
      void recording.stop().catch(() => null);
      if (recTimer) clearInterval(recTimer);
      setRecOn(false);
      await wait(900);
      if (!alive()) return;
      freeze(turnSnap);
      flushSync(() => { setCommand(null); setBarMark(null); setTapWords(null); setVoidWhy('turned'); setPhase('void'); });
      void apiFetch(`/api/attempts/${attempt.id}/turned-void`, { method: 'POST' }).catch(() => {});
      return;
    }
    if (voided) {
      // look 5.14c: "Rack!" runs its 900 ms; as it fades, "We lost the bar." and the sheet on the same
      // frame. Nothing was judged and nothing is kept: the camera stays on for "Film again".
      void recording.stop().catch(() => null);
      if (recTimer) clearInterval(recTimer);
      setRecOn(false);
      await wait(900);
      if (!alive()) return;
      freeze(voidSnap);
      flushSync(() => { setCommand(null); setBarMark(null); setTapWords(null); setPhase('void'); });
      voice.say('lost-bar');
      void apiFetch(`/api/attempts/${attempt.id}/bar-void`, { method: 'POST' }).catch(() => {});
      return;
    }
    const last = grab(video, d);
    const blob = await recording.stop();
    setRecOn(false);
    stopCamera();
    if (!alive()) return;
    // A bench that had its "Start!" always goes to the referee (3.4b): only a referee lights a bench, so the
    // phone never turns a missed press it couldn't follow into "Try again".
    if ((noRep && !ml.byBar) || !blob || !liftAt) {
      await wait(900);
      if (!alive()) return;
      setCommand(null); setPhase('norep'); setWaitLine(noRepLine(lift, lifter.division));
      return;
    }
    // Saved on the phone before anything is sent (3.10), so a reload or a lost signal keeps it.
    // by the corrected clock (item 86), so a slow phone clock can't put a lift before the close
    const savedAt = phoneNow();
    // the bench's `plate_tap` and `press_late_why` go with the command times (3.4b); the server checks them
    const commandTimes = { ...ct, ...(ml.plateTap ? { plate_tap: ml.plateTap } : {}), ...extras } as unknown as Record<string, number>;
    await savePending({ attemptId: attempt.id, blob, type: blob.type || recording.mimeType, commandTimes, uploadId: null, savedAt, recordedAt: Math.round(savedAt - (performance.now() - recording.startedAt)) });
    const heldSnap = (ml.byBar && pressSnap) || (lift === 'squat' && deeperOf(deepest)) || last;
    freeze(heldSnap);
    // her bench clip's marks: the phone's own path, broken where it was lost, and the "Press!" tick
    const bar = ml.bar;
    const pressAt = bar?.cmds.find(c => c.cmd === 'press')?.t;
    const path: BenchPath | null = bar ? { pieces: pathPieces(bar.path), press: pressAt === undefined ? null : tickAt(bar.path, pressAt) } : null;
    const clipUrl = URL.createObjectURL(blob);
    const replay = async (keepPhase = false) => {
      const rv = replayRef.current;
      if (!rv) return;
      rv.src = clipUrl;
      await within(readyToSeek(rv), 3000);
      await within(seekTo(rv, Math.max(0, rv.duration - 2)), 2000);
      if (!keepPhase) setPhase('replay');
      setReplaying(true); setFrozen(false); setMarks(null); setBenchPath(null);
      await rv.play();
      await new Promise<void>(res => { const c = () => (!alive() || rv.ended ? res() : requestAnimationFrame(c)); requestAnimationFrame(c); });
      rv.pause();
    };
    // the frozen frame is the server's judged frame (3.4), found in her own recording, with its marks
    const snapAt = async (ms: number): Promise<SideSnap | null> => {
      const rv = replayRef.current;
      if (!rv) return null;
      if (rv.src !== clipUrl) { rv.src = clipUrl; await within(readyToSeek(rv), 3000); }
      await within(seekTo(rv, ms / 1000), 2000);
      const g = grab(rv, d);
      const p = pose.detect(rv);
      return p ? { ...g, p, side: nearSide({ t: ms, p }) } : g;
    };
    await awaitLights(alive, attempt.id, send(alive, attempt.id), heldSnap, replay, ml.byBar ? undefined : snapAt, path);
  }, [attempt.id, attempt.lift, attempt.reps_declared, home, lifter.division, needWay, stopCamera, awaitLights, send]);
  const runCameraRef = useRef(runCamera);
  useEffect(() => { runCameraRef.current = runCamera; }, [runCamera]);

  /** "Use a sample lift instead" (5.36): the server copies and queues the clip; the phone plays it. */
  const runSample = useCallback(async () => {
    const my = ++runRef.current;
    const alive = () => runRef.current === my;
    const voice = voiceRef.current!;
    const r = await getJson('/api/demo/sample', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attempt_id: attempt.id }) }).catch(() => null);
    if (!alive()) return;
    if (r?.status === 429) { setLimit((r.body.limit as 'lifter' | 'everyone') ?? 'lifter'); setView('limit'); return; }
    if (r?.status !== 200) { console.warn('sample refused', r?.status, r?.body.error); setPhase('refused'); return; }
    const picked = r.body.sample as { id: string; credit: string; reps: number; lift?: string };
    setShownLift(picked.lift ?? 'squat');
    const clip = (samples.clips as SampleClip[]).find(c => c.id === picked.id);
    setSample({ credit: picked.credit, reps: picked.reps });
    // a sample is a squat clip (its own lift's, once there are any): its start and end commands
    const times = clip?.meet?.command_times ?? { loaded: 0, squat: 200, rack: 4000 };
    const ct = { squat: times.squat ?? times.start ?? 200, rack: times.rack ?? times.down ?? 4000 };
    const video = feedRef.current!;
    stopCamera();
    video.srcObject = null;
    video.muted = true; video.playsInline = true;
    if (clip) video.src = `/samples/${clip.file}`;
    if (video.readyState < 2) await within(new Promise(res => video.addEventListener('loadeddata', res, { once: true })), 8000).catch(() => {});
    if (!alive()) return;
    video.pause(); await seekTo(video, 0).catch(() => {});
    const d: Dims = { w: video.videoWidth || 720, h: video.videoHeight || 1280 };
    setDims(d);
    // 5.2 (item 94): a sample is judged on the server (5.36), so the phone never loads the pose model
    // or its wasm for it. The frozen frame is the clip's own, and its marks are the server's points at
    // the judged moment (/api/attempts/:id/frame), as after a reload.
    // 5.25 step 3, look 9 step 3: find your spot on the clip's first frame, as on /try. The
    // segments light head to feet PART_STEP_MS apart, then "Good spot.", then the soft command.
    setPhase('spot');
    let lit: Record<Part, boolean> = NO_PARTS;
    for (const k of PARTS) {
      await sleep(PART_STEP_MS);
      if (!alive()) return;
      lit = { ...lit, [k]: true };
      const l = lit;
      flushSync(() => setParts(l));
    }
    await sleep(PART_STEP_MS);
    if (!alive()) return;
    setPhase('good-spot'); setLine(null);
    setCommand({ text: STAGE_WORDS.goodSpot, kind: 'soft' }); voice.say('good-spot');
    await wait(RULES.tryALift.goodSpotToStandTallMs);
    if (!alive()) return;
    setPhase('loaded'); setCommand({ text: home ? MEET_WORDS.soft.home : MEET_WORDS.soft.barbell, kind: 'soft' });
    voice.say(home ? 'weights-ready' : 'bar-loaded');
    await wait(SOFT_HOLD_MS);
    if (!alive()) return;
    // "SQUAT!", REC, the voice and the clip all start on the same frame (look 7, look 9 step 5):
    // the clip plays from its first frame on the word. The server judges on the clip's own
    // command times, so where the word lands on the phone doesn't change the call.
    const startAt = performance.now();
    flushSync(() => { setPhase('lifting'); setCommand({ text: MEET_WORDS.squat, kind: 'on' }); setRecSec(0); setRecOn(true); });
    voice.say('squat');
    void video.play();
    let said = { squat: true, rack: false }, rackShownAt = 0;
    await new Promise<void>(resolve => {
      const tick = () => {
        if (!alive()) return resolve();
        const ms = video.currentTime * 1000;
        if (said.squat) setRecSec(Math.floor((performance.now() - startAt) / 1000));
        if (!said.rack && (ms >= ct.rack || video.ended)) {
          said = { ...said, rack: true };
          flushSync(() => setCommand({ text: MEET_WORDS.rack, kind: 'on' })); voice.say('rack');
          rackShownAt = performance.now();
        }
        // 3.10, as on a camera lift: the stage runs to 1.5 s after "RACK!". A clip that ends sooner
        // holds its last frame, with "RACK!" up and REC counting, so the word plays out whole
        // (look §6 item 3) before the freeze.
        if (said.rack && performance.now() - rackShownAt >= AFTER_RACK_MS) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (!alive()) return;
    video.pause(); setRecOn(false);
    // a sample's judged frame is known (samples.json, checked by the worker test): held from "Sending to
    // the judges", so the dimmed wait is on the bottom of the squat and the frame doesn't jump at the lights
    // (The Playner, 13 Nov). A clip without one holds the frame halfway from "Squat!" to "Rack!".
    await seekTo(video, (clip?.judged_frame_ms ?? (ct.squat + ct.rack) / 2) / 1000).catch(() => {});
    const snap: SideSnap = grab(video, d);
    freeze(snap);
    const replay = async () => {
      await within(seekTo(video, Math.max(0, ct.rack / 1000 - 2)), 2000);
      setPhase('replay'); setReplaying(true); setFrozen(false); setMarks(null);
      await video.play();
      await new Promise<void>(res => { const c = () => (!alive() || video.ended || video.currentTime >= ct.rack / 1000 ? res() : requestAnimationFrame(c)); requestAnimationFrame(c); });
      video.pause();
    };
    // the judged frame from the clip on the phone, with the server's pose at it for the marks
    const snapAt = async (ms: number): Promise<SideSnap | null> => {
      const r = await getJson(`/api/attempts/${attempt.id}/frame`).catch(() => null);
      const f = r?.status === 200 ? (r.body as unknown as { ms: number; p: Pt[]; side: 'left' | 'right' }) : null;
      await within(seekTo(video, (f?.ms ?? ms) / 1000), 2000);
      const shot = grab(video, d);
      return f ? { ...shot, t: f.ms, p: f.p, side: f.side } : shot;
    };
    await awaitLights(alive, attempt.id, Promise.resolve(true), snap, replay, snapAt);
  }, [attempt.id, home, stopCamera, awaitLights]);

  /** A reload in the middle: keep sending what's saved, and wait for the lights. */
  const runResume = useCallback(async () => {
    const my = ++runRef.current;
    const alive = () => runRef.current === my;
    const saved = await getPending(attempt.id).catch(() => undefined);
    if (!alive()) return;
    const sent = saved ? send(alive, attempt.id) : Promise.resolve(true);
    // after a reload, her clip comes back from R2 with the pose the judge saw: the frame and its marks
    const snapAt = async (): Promise<SideSnap | null> => {
      const r = await getJson(`/api/attempts/${attempt.id}/frame`);
      const rv = replayRef.current;
      if (r.status !== 200 || !rv) return null;
      const f = r.body as unknown as { clip_url: string; ms: number; p: Pt[]; side: 'left' | 'right' };
      rv.src = f.clip_url;
      await within(readyToSeek(rv), 6000);
      await within(seekTo(rv, f.ms / 1000), 4000);
      const d = { w: rv.videoWidth, h: rv.videoHeight };
      if (!d.w || !d.h) return null;
      setDims(d);
      return { ...grab(rv, d), p: f.p, side: f.side };
    };
    // the held breath holds her lift's frame, dimmed (look 7), not a black stage: from the clip
    // still on the phone, else from the copy the server has (her upload, or a sample's)
    const held = async (): Promise<SideSnap | null> => {
      const rv = replayRef.current;
      if (!rv) return null;
      let url: string, ms: number | null;
      if (saved) { url = URL.createObjectURL(saved.blob); ms = heldFrameMs(saved.commandTimes); }
      else {
        const r = await getJson(`/api/attempts/${attempt.id}/frame?held=1`);
        if (r.status !== 200) return null;
        const f = r.body as unknown as { clip_url: string; ms: number | null };
        url = f.clip_url; ms = f.ms;
      }
      rv.src = url;
      await within(readyToSeek(rv), 6000);
      const d = { w: rv.videoWidth, h: rv.videoHeight };
      if (!d.w || !d.h) return null;
      const at = ms ?? (Number.isFinite(rv.duration) ? rv.duration * 500 : 0);
      await within(seekTo(rv, at / 1000), 4000);
      setDims(d);
      return grab(rv, d);
    };
    // what the server has: a sample keeps its box and credit, and a decided attempt opens settled
    const r0 = saved ? null : await getJson(`/api/attempts/${attempt.id}`).catch(() => null);
    if (!alive()) return;
    const st = r0?.status === 200 ? (r0.body as unknown as State) : null;
    if (st?.sample) { setResumedSample(true); if (st.sample_clip) setSample({ credit: st.sample_clip.credit, reps: st.sample_clip.reps }); }
    if (st?.call === 'white' || st?.call === 'red') {
      const shown = st.shown_lift ?? attempt.lift;
      const res = meetResult({ ...st, lift: attempt.lift })!;
      setShownLift(shown); setSettledOpen(true);
      setResult(res); setLamps(res.lamps); setSpill(st.call === 'white' ? 'white' : 'red');
      setResultOn(true); setWaitLine(''); setBusy(false); setPhase('hold');
      const judged = await snapAt().catch(() => null) ?? await held().catch(() => null);
      if (!alive()) return;
      freeze(judged);
      if (judged?.p.length) setMarks(liftMarks(shown, judged.p, { w: judged.canvas.width, h: judged.canvas.height }, judged.side));
      return;
    }
    // F-E: a close call opens settled, pulsing, with "To a referee" in the panel at once, not the judging wait
    if (st?.call === 'close') {
      setShownLift(st.shown_lift ?? attempt.lift); setSettledOpen(true);
      setLamps(['pulse', 'pulse', 'pulse']); setCommand(null);
      setWaitLine(bench ? MEET_WORDS.bench.looking : 'A referee is looking at this one');
      setResult(meetResult({ ...st, lift: attempt.lift })); setPhase('close'); setResultOn(true);
      // the judged frame and its marks (LookieBot 1), else the held frame
      const judged = bench ? null : await snapAt().catch(() => null);
      if (!alive()) return;
      const snap = judged ?? await held().catch(() => null);
      if (!alive()) return;
      freeze(snap);
      if (judged?.p.length) setMarks(liftMarks(st.shown_lift ?? attempt.lift, judged.p, { w: judged.canvas.width, h: judged.canvas.height }, judged.side));
      await awaitLights(alive, attempt.id, sent, snap, async () => {}, snapAt, null, true);
      return;
    }
    setPhase(p => (p === 'hold' ? 'held' : p));
    const snap = await held().catch(() => null);
    if (!alive()) return;
    freeze(snap);
    await awaitLights(alive, attempt.id, sent, snap, async () => {}, snapAt);
  }, [attempt.id, attempt.lift, bench, send, awaitLights]);

  const start = (m: Mode) => {
    // her tap: an iPhone that allowed motion before gets it back with no question (look 4b)
    orientRef.current.renew();
    // item 85: a lift started at or after the close isn't judged. Nothing films and nothing is
    // uploaded; the server marks it `void` (`after_close`) by its own clock. If the server says the
    // platform is still open (her phone's clock ran ahead), the lift goes ahead.
    if (m !== 'spot' && closesAt && phoneNow() >= Date.parse(closesAt)) {
      setWin({ reason: 'after_close', closesAt, deadline: null });
      setView('window');
      void apiFetch(`/api/attempts/${attempt.id}/after-close`, { method: 'POST' })
        .then(r => { if (r.status === 409) { setWin(null); go(m); } })
        .catch(() => {});
      return;
    }
    go(m);
  };
  const go = (m: Mode, asked = false) => {
    // look 4b: the motion step, once, in the first bench's frame check, before the camera starts (iPhone)
    if (bench && !asked && m !== 'sample' && m !== 'resume' && orientRef.current.needsAsk) {
      setAskFor(m); setView('motion');
      return;
    }
    resetStage();
    setMode(m);
    setView('stage');
    audio();
    voiceRef.current!.unlock();
    void voiceRef.current!.load();
    requestAnimationFrame(() => {
      if (m === 'sample') void runSample();
      else if (m === 'resume') void runResume();
      else void runCamera(m === 'spot', m === 'refilm');
    });
  };

  useEffect(() => {
    if (startView === 'stage') { requestAnimationFrame(() => void runResume()); return; }
    // 3.11, "come back later": she went offline before the server heard of the upload, so the
    // attempt still reads declared. Her clip is saved on this phone: it sends and is judged, and
    // the card never offers "I'm ready" for a lift she has already lifted.
    let on = true;
    const run = runRef.current;
    void getPending(attempt.id).then(p => {
      if (!on || !p || runRef.current !== run) return;
      resetStage(); setMode('resume'); setView('stage'); setPhase('held');
      requestAnimationFrame(() => void runResume());
    }).catch(() => {});
    return () => { on = false; };
    // only on the first render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // busy from "I'm ready" until the result panel has slid in (480 ms; at once with motion off)
  const resultIn = ['held', 'offline', 'lit', 'close', 'replay', 'hold', 'norep', 'refused'].includes(phase);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (view !== 'stage' || !resultIn) { setSettled(false); return; }
    const t = setTimeout(() => setSettled(true), reduced() ? 0 : 480);
    return () => clearTimeout(t);
  }, [view, resultIn]);
  const underBar = view === 'stage' && !settled;
  useEffect(() => { onBusy?.(underBar); }, [underBar, onBusy]);
  useEffect(() => () => onBusy?.(false), [onBusy]);

  const toCard = () => { runRef.current++; stopCamera(); resetStage(); setView('card'); };

  const liftName = liftCaps(attempt.lift, lifter.division);
  const ofLine = `Attempt ${attempt.number} of 3`;
  const loading = loadingLine(lifter.division, attempt.weight, lifter.units, attempt.lift, attempt.kind ?? undefined);
  const standIn = shownLift !== attempt.lift ? standInLine(shownLift, attempt.lift, lifter.division) : null;

  if (view === 'limit') {
    return (
      <div className="try-page meet-page"><main className="try-col meet-col" role="alert">
        <p className="body-l">{MEET_WORDS.limit[limit]}</p>
        <div className="try-actions"><Link className="btn ghost" href="/sample">Watch a meet night</Link></div>
      </main></div>
    );
  }

  if (view === 'window' && win) {
    // 3.11: one sheet, one Primary. With nothing judged after the close, "OK" goes to the closed page (5.24).
    const closed = win.reason === 'after_close';
    const toTotal = !closed || anyJudged;
    return (
      <div className="try-page meet-page"><main className="try-col meet-col" role="alert">
        <h1 className="sheet-title">{closed ? WINDOW_WORDS.closedTitle : WINDOW_WORDS.lateTitle}</h1>
        <p className="body">
          {closed
            ? (win.closesAt ? <WindowText say={{ kind: 'closed', closesAt: win.closesAt }} /> : null)
            : (win.deadline ? <WindowText say={{ kind: 'late', deadline: win.deadline }} /> : null)}
        </p>
        <div className="try-actions">
          <a className="btn" href={toTotal ? '/platform/total' : '/platform'}>{toTotal ? WINDOW_WORDS.seeTotal : WINDOW_WORDS.ok}</a>
        </div>
      </main></div>
    );
  }

  if (view === 'motion' && askFor) {
    // look 4b: one step on --chalk. "Allow motion & orientation" is iPhone's own wording in the question
    // that follows, so the two match. Either answer goes on to the frame check.
    const on = () => { audio(); voiceRef.current!.unlock(); };
    return (
      <div className="try-page meet-page"><main className="try-col meet-col motion-step">
        <LiftIcon name="bench" size={32} />
        <h1 className="sheet-title">{ORIENT_WORDS.ask.title}</h1>
        <p className="body">{ORIENT_WORDS.ask.body}</p>
        <div className="try-actions">
          <button className="btn" type="button" onClick={() => { on(); void orient.allow().then(() => go(askFor, true)); }}>{ORIENT_WORDS.ask.allow}</button>
          <button className="link" type="button" onClick={() => { on(); orient.notNow(); go(askFor, true); }}>{ORIENT_WORDS.ask.notNow}</button>
        </div>
      </main></div>
    );
  }

  if (view === 'denied' || view === 'nocamera') {
    return (
      <div className="try-page meet-page"><main className="try-col meet-col" role="alert">
        {view === 'denied' ? (
          <>
            <h1 className="sheet-title">First Meet can&apos;t see your camera</h1>
            <p className="body">Android Chrome: Tap the icon left of the address, then Permissions, then Camera, Allow.</p>
            <p className="body">iPhone Safari: Tap aA in the address bar, then Website Settings, then Camera, Allow.</p>
          </>
        ) : <p className="body-l">{demo ? 'This device has no camera we can use. Use a sample lift, or open First Meet on your phone.' : 'This device has no camera we can use. Open First Meet on your phone.'}</p>}
        <div className="try-actions">
          {view === 'denied' && <button className="btn" type="button" onClick={() => start('lift')}>Try again</button>}
          {demo && <button className={`btn${view === 'denied' ? ' ghost' : ''}`} type="button" onClick={() => start('sample')}>Use a sample lift instead</button>}
        </div>
      </main></div>
    );
  }

  if (view === 'card') {
    return (
      <div className="try-page meet-page look-56"><main className="try-col meet-col">
        {top}
        <article className="attempt-card" aria-label={`${liftName}, ${ofLine}`}>
          <div className="ac-row1">
            <h1 className="lift-name">{home ? `${liftName} · ${ofLine}` : liftName}</h1>
            {!home && <span className="body ac-of">{ofLine}{attempt.number === 1 && <span className="ac-opener"> · opener</span>}</span>}
          </div>
          <p className="weight-xl num" style={{ '--digits': weightDigits(home ? attempt.reps_declared ?? 0 : attempt.weight) } as React.CSSProperties}>
            {home ? attempt.reps_declared : attempt.weight}<span className="unit">{home ? 'reps' : lifter.units}</span>
            {notJudged && <span className="eyebrow tag">Not judged yet</span>}
          </p>
          {home ? <BellDiagram label={loading} /> : <BarDiagram weight={attempt.weight} units={lifter.units} label={loading} />}
          <p className="small">{loading}</p>
          <p className="body ac-because">{because}</p>
        </article>
        {/* look 5.6: the Primary on its own, a direct child of the column, so it can dock */}
        <ReadyDock><button className="btn" type="button" onClick={() => start('lift')}>I&apos;m ready</button></ReadyDock>
        <div className="try-actions ready-links">
          {demo && <button className="link" type="button" onClick={() => start('sample')}>Use a sample lift instead</button>}
          <button className="link" type="button" onClick={() => start('spot')}>Test your spot first</button>
        </div>
        {strip}
      </main></div>
    );
  }

  // The stage.
  const isSample = mode === 'sample' || resumedSample;
  const box = containBox(stageSize, dims);
  const lifting = phase === 'spot' || phase === 'good-spot' || phase === 'tap' || phase === 'loaded' || phase === 'lifting';
  // the bench: no panel while it sends (look 5.14c), so the stage keeps the full width
  const panelOpen = !lifting && !(phase === 'loading' && !slow && !error) && !(bench && phase === 'held');
  const stageClass = ['stage',
    turnUp.on ? 'turning' : '',
    turnedOnce ? 'turned-once' : '',
    phase === 'spot' || phase === 'good-spot' ? 'spotting' : '',
    recOn ? 'recording' : '',
    phase === 'held' || phase === 'offline' || phase === 'close' ? 'judging' : '',
    phase === 'norep' ? 'norep' : '',
    phase === 'void' ? 'voided' : '',
    bench && benchPath && phase === 'close' ? 'benchclip' : '',
    phase === 'lit' || phase === 'replay' || phase === 'hold' ? 'lit' : '',
    frozen ? 'frozen' : '',
    // look, the held first frame (LookieBot 2): a sample's first frame is dimmed 24% from the frame check until "Squat!"
    isSample && (phase === 'spot' || phase === 'good-spot' || phase === 'loaded') ? 'held' : '',
  ].filter(Boolean).join(' ');
  const k = dims ? box.width / dims.w : 1;
  const colour = phase === 'close' ? 'var(--stage-ink-2)' : result?.title === 'Good lift' ? 'var(--lamp-white)' : 'var(--lamp-red)';
  const recLabel = `REC ${Math.floor(recSec / 60)}:${String(recSec % 60).padStart(2, '0')}`;
  const waiting = phase === 'held' || phase === 'offline';
  const judged = phase === 'lit' || phase === 'replay' || phase === 'hold';
  const nextLabel = nextLabelProp ?? nextButton(attempt.lift, attempt.number, lifter.division);

  return (
    <div className={`try-app meet-app${settledOpen ? ' settled-open' : ''}${land ? ' land' : ''}`}>
      <section className={`try-stagecol${panelOpen ? '' : ' full'}`} aria-label={isSample ? 'Sample lift' : 'Your lift'}>
        <div className={stageClass} ref={stageRef}>
          <div className={`footage${isSample ? '' : ' mirror'}`} style={box} ref={footageRef}>
            <video ref={feedRef} className="feed" playsInline muted aria-hidden="true" hidden={replaying && !isSample} />
            <video ref={replayRef} className="feed replay" playsInline muted aria-hidden="true" hidden={!replaying || isSample} />
            <canvas ref={frozenRef} className="feed" aria-hidden="true" hidden={!frozen} />
            {isSample && <div className="held-dim" />}
            {marks && dims && (
              <svg className="marks" viewBox={`0 0 ${dims.w} ${dims.h}`} aria-hidden="true">
                <polyline points={marks.pts.map(q => `${q.x},${q.y}`).join(' ')} fill="none" stroke={colour} strokeWidth={2.5 / k} strokeDasharray={`${6 / k} ${5 / k}`} />
                {marks.pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={6 / k} fill={colour} />)}
              </svg>
            )}
            {benchPath && dims && (frozen || phase === 'hold') && (
              // her bench clip (look 5.14c): the plate's path, 2.5 px dashed 6/5 in --stage-ink-2, broken where
              // it was lost, and a 2 x 12 px tick across it where "Press!" came. Never red.
              <svg className="marks bench-path" viewBox={`0 0 ${dims.w} ${dims.h}`} aria-hidden="true">
                {benchPath.pieces.map((pc, i) => (
                  <polyline key={i} points={pc.map(q => `${q.x * dims.w},${q.y * dims.h}`).join(' ')} fill="none" stroke="var(--stage-ink-2)" strokeWidth={2.5 / k} strokeDasharray={`${6 / k} ${5 / k}`} />
                ))}
                {benchPath.press && (
                  <line className="tick" x1={benchPath.press.x * dims.w - 6 / k} x2={benchPath.press.x * dims.w + 6 / k} y1={benchPath.press.y * dims.h} y2={benchPath.press.y * dims.h} stroke="var(--stage-ink-2)" strokeWidth={2 / k} />
                )}
              </svg>
            )}
          </div>
          {bench && barMark && (
            // the bar mark (look 5.14c): four corner brackets, never a ring, placed in the footage's own box
            <div className="barmark-layer" style={box} aria-hidden="true">
              <div key={barMark.n} ref={markRef} className={`barmark${barMark.on ? '' : ' off'}`}
                style={{ left: `${(1 - barMark.x) * 100}%`, top: `${barMark.y * 100}%`, width: markSide(box.height, barMark.size), height: markSide(box.height, barMark.size) }}>
                <i /><i /><i /><i />
              </div>
            </div>
          )}
          {bench && (phase === 'tap' || phase === 'loaded') && (
            // her tap: the whole camera view is the target (look 5.14c)
            <button className="tap-target" type="button" aria-label={MEET_WORDS.bench.tap}
              onPointerDown={e => tapRef.current?.(e.nativeEvent.offsetX, e.nativeEvent.offsetY)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { const f = footageRef.current; if (f) tapRef.current?.(f.offsetLeft + f.offsetWidth / 2, f.offsetTop + f.offsetHeight / 2); } }} />
          )}
          <div className="vignette" />
          <div className="dim" />
          <div className={`spill${spill ? ` ${spill} on` : ''}`} />
          <div className="hud meet-hud">
            <button className="close" type="button" aria-label="Back to the attempt card" onClick={toCard} disabled={!lifting && phase !== 'loading' && phase !== 'spot-done' && phase !== 'norep'}><X weight="bold" /></button>
            <div className={`meet-hud-text${isSample && standIn ? ' standing-in' : ''}`}>
              <div className="eyebrow">{`${liftName} · ${attempt.number} OF 3`}</div>
              {isSample && <div className="eyebrow try-what boxed">Sample lift</div>}
              {isSample && standIn && <p className="caption meet-stand-in">{standIn}</p>}
              {isSample && home && sample && <p className="caption meet-sample-reps">{sampleRepsLine(sample.reps)}</p>}
              <div className="caption meet-hud-who">{hudLine(lifter.cardName, lifter.ageGroup, lifter.division)}</div>
            </div>
            <div className="meet-hud-right">
              <div className="meet-hud-weight num">{home ? `${attempt.weight} ${lifter.units}` : `${attempt.weight} ${lifter.units}`}</div>
              {home && attempt.reps_declared && (phase === 'lifting' || recOn) && <div key={reps} className="meet-reps num" aria-live="polite">{`${reps} / ${attempt.reps_declared}`}</div>}
            </div>
            <button className="close try-sound-toggle" type="button" aria-label={sound ? 'Sound on' : 'Sound off'} aria-pressed={sound} onClick={() => setSound(s => !s)}>
              {sound ? <SpeakerHigh weight="bold" /> : <SpeakerSlash weight="bold" />}
            </button>
          </div>
          <Lamps states={lamps} settled={settledOpen} />
          <WaitLine text={waitLine} lineRef={waitLineRef} />
          <div className="command" aria-live="assertive">
            {command && <span key={command.text} className={`c ${command.kind === 'soft' ? 'soft hold' : 'on'}`}>{command.text}</span>}
          </div>
          {phase === 'spot' && line && !turnUp.on && <p className="spotline" aria-live="polite">{line}</p>}
          {turnUp.on && (
            // 3.10, look 4a: the turning phone and its line; with no gravity ("Not now" or no sensor) the drawing
            // is dimmed and still, with the rotation-lock line under it at full strength
            <div className={`turnphone${orient.noMotion ? ' dimmed' : ''}${turnUp.out ? ' out' : ''}`} aria-live="polite">
              <div className={`phone-draw to-${needWay}`} aria-hidden="true" />
              <p className="body">{ORIENT_WORDS.turn[needWay]}</p>
              {orient.noMotion && orient.kind && <p className="body">{ORIENT_WORDS.lock[orient.kind]}</p>}
            </div>
          )}
          {bench && tapWords && (phase === 'tap' || phase === 'loaded') && (
            // look 5.14c: in over 200 ms, out over 160 ms on her tap
            <div key={tapWords.which} className={`tapwords${tapWords.on ? '' : ' out'}`} aria-live="polite">
              <p className="sheet-title">{tapWords.which === 'tap' ? MEET_WORDS.bench.tap : MEET_WORDS.bench.lost}</p>
              <p className="small">{tapWords.which === 'tap' ? MEET_WORDS.bench.tapSmall : MEET_WORDS.bench.lostSmall}</p>
            </div>
          )}
          <div className="spotparts" aria-label="What the phone can see">
            {PARTS.map(p => <span key={p} className={parts[p] ? 'seen' : ''}>{p}</span>)}
          </div>
          <div className="rec" aria-hidden="true"><b /><span>{recLabel}</span></div>
          {!isSample && <div className={`cliptag${phase === 'replay' || (phase === 'hold' && frozen) || (bench && phase === 'close' && (replaying || benchPath)) ? ' on' : ''}`}>Your clip</div>}
          {isSample && sample && <div className="credit">{sample.credit}</div>}
        </div>

        <div className="panel" aria-hidden={!panelOpen}>
          <div className="panel-in">
            {slow && <p className="small">{STAGE_WORDS.slowModel}</p>}
            {phase === 'spot-done' && (
              <>
                <p className="sheet-title">Good spot. You&apos;re ready.</p>
                <div className="try-actions"><button className="btn" type="button" onClick={toCard}>Back to my attempt</button></div>
              </>
            )}
            {phase === 'norep' && (
              <div className="try-actions">
                <button className="btn" type="button" onClick={() => start('lift')}>Try again</button>
                {demo && <button className="link" type="button" onClick={() => start('sample')}>Use a sample lift instead</button>}
              </div>
            )}
            {phase === 'offline' && (
              <div role="status">
                <p className="sheet-title">{MEET_WORDS.offlineTitle}</p>
                <p className="body">{MEET_WORDS.offlineBody}</p>
                <div className="try-actions">
                  <button className="btn" type="button" onClick={() => {
                    // 3.11 (item 59): the sheet closes and focus lands on "Sending to the judges", where she is
                    offlineOkRef.current = true;
                    flushSync(() => { setPhase('held'); setWaitLine(MEET_WORDS.sending); });
                    waitLineRef.current?.focus();
                  }}>OK</button>
                </div>
              </div>
            )}
            {phase === 'void' && (
              // 3.4b, look 5.14c: the bench's void sheet. "Film again" is the only way on.
              // 3.10: a phone that turned during the lift gets the same sheet with its own words, and films the
              // attempt again from the frame check, since the phone has moved.
              <div className="void-sheet" role="alertdialog" aria-labelledby="void-title" aria-describedby="void-body" tabIndex={-1} ref={voidRef}>
                <p className="sheet-title" id="void-title">{voidWhy === 'turned' ? ORIENT_WORDS.turned.title : MEET_WORDS.bench.voidTitle}</p>
                <p className="body" id="void-body">{voidWhy === 'turned' ? ORIENT_WORDS.turned.body : MEET_WORDS.bench.voidBody}</p>
                <div className="try-actions"><button className="btn" type="button" onClick={() => go(voidWhy === 'turned' ? 'lift' : 'refilm')}>{voidWhy === 'turned' ? ORIENT_WORDS.turned.filmAgain : MEET_WORDS.bench.filmAgain}</button></div>
              </div>
            )}
            {phase === 'refused' && (
              <div role="alert">
                <p className="sheet-title">{REFUSED_WORDS.title}</p>
                <p className="body">{REFUSED_WORDS.body}</p>
                <div className="try-actions"><button className="btn" type="button" onClick={toCard}>Lift it again</button></div>
              </div>
            )}
            <div className="live" aria-live="polite">
              {waiting && phase !== 'offline' && (
                <div className="breathe">
                  <p className="sheet-title">{MEET_WORDS.breathe}</p>
                  <p className="body">{MEET_WORDS.breatheBody}</p>
                  {busy && <p className="body">{MEET_WORDS.busy90Panel}</p>}
                  {slowUpload && <p className="small">{MEET_WORDS.slowUpload}</p>}
                </div>
              )}
              {result && (phase === 'close' || judged) && (
                <div className={`result${resultOn ? ' on' : ''}${result.reason ? ' no' : ''}`}>
                  <h2>{result.title}</h2>
                  {result.small && <p className="small">{result.small}</p>}
                  {result.reason && <div className="why"><b>{result.reason.eyebrow}</b><span>{result.reason.text}</span></div>}
                  {result.body && <p className="main">{result.body}</p>}
                  {standIn && result.title === 'Good lift' && <p className="small stand-in">{standIn}</p>}
                </div>
              )}
            </div>
            {waiting && busy && onNext && (
              <div className="try-actions"><button className={nextGhost ? 'btn ghost' : 'btn'} type="button" onClick={onNext}>{nextLabel}</button></div>
            )}
            {(phase === 'close' || (judged && resultOn)) && (
              <div className="after">
                <hr className="rule" />
                <div className="try-actions">
                  {onNext && <button className={nextGhost ? 'btn ghost' : 'btn'} type="button" onClick={onNext}>{nextLabel}</button>}
                  {phase === 'close' && demoReferee && <Link className="link" href={`/referee/demo/${attempt.id}`}>{result?.title === 'To a referee' ? MEET_WORDS.bench.refereeLink : MEET_WORDS.refereeLink}</Link>}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** The video's current frame, with no points (no marks). */
function grab(video: HTMLVideoElement, d: Dims): SideSnap {
  const c = document.createElement('canvas'); c.width = d.w; c.height = d.h;
  c.getContext('2d')!.drawImage(video, 0, 0, d.w, d.h);
  return { t: 0, depth: 0, p: [], canvas: c, side: 'left' };
}

/** The deeper of the two sides' deepest frames: the judged moment (or the judged side's, when known). */
type SideSnap = Snap & { side: 'left' | 'right' };
function deeperOf(d: DeepestFrames, judged?: 'left' | 'right'): SideSnap | null {
  if (judged) { const s = d.get(judged); if (s) return { ...s, side: judged }; }
  const l = d.get('left'), r = d.get('right');
  if (!l) return r && { ...r, side: 'right' };
  if (!r) return { ...l, side: 'left' };
  return r.depth > l.depth ? { ...r, side: 'right' } : { ...l, side: 'left' };
}
