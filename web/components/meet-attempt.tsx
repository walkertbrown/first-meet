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
import { Lamps, type LampState } from '@/components/lamps';
import { BarDiagram, BellDiagram } from '@/components/bar-diagram';
import { ReadyDock } from '@/components/ready-dock';
import { loadPoseModel, LivePose } from '@/lib/stage/pose-live';
import { Voice, type VoiceKey } from '@/lib/stage/voice';
import { thock, audio } from '@/lib/stage/thock';
import { DeepestFrames, liftMarks, type LiftMarks, type Snap } from '@/lib/stage/snap';
import { Recording, readyToSeek, seekTo, sleep, within } from '@/lib/stage/recorder';
import { STAGE_WORDS } from '@/lib/stage/try-words';
import {
  COMMAND_TEXT, MEET_WORDS, REFUSED_WORDS, hudLine, liftCaps, liftCommands, loadingLine, meetResult, nextButton, noRepLine, sampleRepsLine,
  standInLine, weightDigits, WINDOW_WORDS, type MeetResult,
} from '@/lib/stage/meet-words';
import { WindowText } from '@/components/window-words';
import { PLAN_SWITCHES } from '@/lib/plan-switches';
import { keepSending, getPending, savePending, type UploadStatus } from '@/lib/stage/uploader';
import { apiFetch, phoneNow } from '@/lib/stage/server-clock';
import samples from '../../content/samples/samples.json';
import { WaitLine } from '@/components/wait-line';

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
  /** The panel button as a Ghost (item 76: "Back to the platform", 5.27). */
  nextGhost?: boolean;
  /** Above the attempt card: the platform's eyebrow and the 9-attempt row (5.24). */
  top?: React.ReactNode;
  /** No judged set behind the cap yet: the `NOT JUDGED YET` tag beside the weight (look 5.6). */
  notJudged?: boolean;
  /** The demo meet's close call has "Be the referee" (5.36); a real meet's waits for a real referee. */
  demoReferee?: boolean;
  /** Under the attempt card, during flight time: "Your flight is lifting" (5.24, look 5.8). */
  strip?: React.ReactNode;
  /** item 81: the flight strip goes under the links, not above "I'm ready" */
  item81?: boolean;
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

type View = 'card' | 'stage' | 'denied' | 'nocamera' | 'limit' | 'window';
type Mode = 'lift' | 'spot' | 'sample' | 'resume';
type Phase = 'loading' | 'spot' | 'good-spot' | 'spot-done' | 'loaded' | 'lifting' | 'norep' | 'held' | 'lit' | 'close' | 'replay' | 'hold' | 'offline' | 'refused';
type Command = { text: string; kind: 'soft' | 'on' } | null;
type State = { status: string; shown_lift?: string; call: 'white' | 'red' | 'close' | null; lights: ('white' | 'red')[] | null; reason: string | null; red_rep: number | null; reps_declared: number | null; wait_minutes: number | null; judging?: 'normal' | 'busy' | 'paused' | null; judged_frame_ms?: number | null };
type SampleClip = { id: string; file: string; credit: string; meet?: { reps: number; command_times: Record<string, number> } };

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

export function MeetAttempt({ attempt, lifter, because, voicePack, onNext, nextLabel: nextLabelProp, nextGhost = false, top, notJudged, demoReferee = true, strip, onBusy, closesAt = null, anyJudged = false, item81 = PLAN_SWITCHES.item81 }: MeetAttemptProps) {
  const [win, setWin] = useState<WindowStop | null>(null);
  const first = attempt;
  const home = lifter.division === 'home';
  const startView: View = first.status === 'declared' ? 'card' : 'stage';
  const [view, setView] = useState<View>(startView);
  const [mode, setMode] = useState<Mode>(startView === 'stage' ? 'resume' : 'lift');
  const [sound, setSound] = useState(true);
  const [limit, setLimit] = useState<'lifter' | 'everyone'>('lifter');

  const [phase, setPhase] = useState<Phase>(startView === 'stage' ? 'held' : 'loading');
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
  const [error, setError] = useState('');

  const stageRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLVideoElement>(null);
  const replayRef = useRef<HTMLVideoElement>(null);
  const frozenRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const voiceRef = useRef<Voice | null>(null);
  const runRef = useRef(0);
  /** She tapped "OK" on the offline sheet: it stays closed while the clip keeps trying (3.11). */
  const offlineOkRef = useRef(false);
  const waitLineRef = useRef<HTMLDivElement>(null);
  const soundRef = useRef(sound);

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
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => () => { runRef.current++; stopCamera(); }, [stopCamera]);

  const resetStage = () => {
    setPhase('loading'); setSlow(false); setParts(NO_PARTS); setLine(null); setCommand(null); setRecOn(false); setReps(0);
    setLamps(['off', 'off', 'off']); setWaitLine(''); setBusy(false); setSlowUpload(false); setSpill(''); setResult(null); setResultOn(false);
    setFrozen(false); setMarks(null); setReplaying(false); setSample(null); setError(''); setShownLift(attempt.lift);
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
  const awaitLights = useCallback(async (alive: () => boolean, attemptId: string, sent: Promise<boolean>, snap: SideSnap | null, replay: () => Promise<void>, snapAt?: (ms: number) => Promise<SideSnap | null>) => {
    const t0 = performance.now();
    setPhase('held'); setCommand(null); setWaitLine(MEET_WORDS.sending);
    const ok = await sent;
    if (!ok || !alive()) return;
    await sleep(Math.max(0, SENDING_MIN_MS - (performance.now() - t0)));
    if (!alive()) return;
    setWaitLine(MEET_WORDS.looking);
    const lookingAt = performance.now();

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
    const t45 = setTimeout(() => alive() && setWaitLine(MEET_WORDS.still45), Math.max(0, 45_000 - (performance.now() - t0)));
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
    const t90 = setTimeout(() => { void estimate(); every = setInterval(() => void estimate(), BUSY_REFRESH_MS); },
      Math.max(0, 90_000 - (performance.now() - t0)));
    const stop = () => { es?.close(); clearInterval(poll); clearTimeout(t45); clearTimeout(t90); clearInterval(every); };
    const next = () => new Promise<void>(res => { wake = res; });

    try {
      await check();
      let pulsing = false;
      for (;;) {
        if (!alive()) return;
        const s = state as State | null;
        if (s?.call === 'close' && !pulsing) {
          pulsing = true;
          await sleep(Math.max(0, RULES.tryALift.judgeLookingMinMs - (performance.now() - lookingAt)));
          if (!alive()) return;
          clearTimeout(t45); clearTimeout(t90); clearInterval(every);
          setLamps(['pulse', 'pulse', 'pulse']); setWaitLine('A referee is looking at this one');
          setShownLift(s.shown_lift ?? attempt.lift);
          setResult(meetResult({ ...s, lift: attempt.lift })); setPhase('close'); setResultOn(true);
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
      if (!reduced()) { await replay().catch(() => {}); if (!alive()) return; }
      setReplaying(false);
      // a sample's frozen frame is the server's judged moment, when it says which
      let judged = snap;
      if (snapAt && typeof s.judged_frame_ms === 'number') judged = (await snapAt(s.judged_frame_ms).catch(() => null)) ?? snap;
      if (!alive()) return;
      setFrozen(!!freeze(judged));
      if (judged?.p.length) setMarks(liftMarks(shown, judged.p, { w: judged.canvas.width, h: judged.canvas.height }, judged.side));
      setPhase('hold');
    } finally { stop(); }
  }, [attempt.lift]);

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
  const runCamera = useCallback(async (spotOnly: boolean) => {
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
    video.removeAttribute('src');
    video.srcObject = streamRef.current;
    video.muted = true; video.playsInline = true;
    if (video.readyState < 2) await new Promise(r => video.addEventListener('loadeddata', r, { once: true }));
    if (!alive()) return;
    await video.play().catch(() => {});
    const d: Dims = { w: video.videoWidth, h: video.videoHeight };
    setDims(d);

    const slowTimer = setTimeout(() => alive() && setSlow(true), 4000);
    let pose: LivePose;
    try { pose = new LivePose(await loadPoseModel()); } catch { clearTimeout(slowTimer); if (alive()) setSlow(true); return; }
    clearTimeout(slowTimer);
    if (!alive()) return;
    setSlow(false); setPhase('spot');

    const lift = asLift(attempt.lift);
    const ml = new MeetLift(d, lift, { reps: home ? attempt.reps_declared ?? 1 : null });
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

    await new Promise<void>(resolve => {
      const done = () => { if (recTimer) clearInterval(recTimer); resolve(); };
      const tick = () => {
        if (!alive()) return done();
        const now = performance.now();
        if (video.currentTime === lastMedia) return void requestAnimationFrame(tick);
        lastMedia = video.currentTime;
        const f = { t: now - t0, p: pose.detect(video) };
        // the squat's held frame is its deepest; other lifts hold their last frame
        if (lift === 'squat' && liftAt) deepest.offer(f, video);
        for (const ev of ml.feed(f)) {
          if (ev.type === 'spot') { setParts(cur => (PARTS.every(k => cur[k] === ev.spot.parts[k]) ? cur : ev.spot.parts)); setLine(ev.spot.line); }
          else if (ev.type === 'good-spot') {
            setPhase('good-spot'); setLine(null); setParts({ head: true, hips: true, knees: true, feet: true });
            setCommand({ text: STAGE_WORDS.goodSpot, kind: 'soft' }); voice.say('good-spot');
            if (spotOnly) { spotDone = true; return done(); }
          } else if (ev.type === 'loaded') {
            // 5.25 step 4: the soft command; the recording starts here, so it is 0 in command_times
            setPhase('loaded'); setCommand({ text: home ? MEET_WORDS.soft.home : MEET_WORDS.soft.barbell, kind: 'soft' });
            voice.say(home ? 'weights-ready' : 'bar-loaded');
            if (streamRef.current) recording.start(streamRef.current);
            ct.loaded = 0;
            if (lift === 'deadlift') startRec(now);
          } else if (ev.type === 'call') {
            ct[ev.key] = since(now);
            if (ev.word !== 'press') startRec(now);
            show(COMMAND_TEXT[ev.word]); voice.say(ev.word);
          } else if (ev.type === 'rep') {
            ct[ev.key] = since(now); setReps(ev.k);
            // a Home deadlift says "Down!" after each rep (3.8a); the others count softly
            if (ev.down) { show(COMMAND_TEXT.down); voice.say('down'); }
            else if (ev.k <= 20) voice.say(`count-${ev.k}` as VoiceKey);
          } else if (ev.type === 'end') {
            endAt = now; ct[ev.key] = since(now); noRep = ev.noRep;
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
    if (spotDone) {
      await wait(900);
      if (!alive()) return;
      stopCamera(); setCommand(null); setPhase('spot-done');
      return;
    }
    // 3.10: recording stops 1.5 s after "Rack!" / "Down!"
    await sleep(Math.max(0, endAt + AFTER_RACK_MS - performance.now()));
    const last = grab(video, d);
    const blob = await recording.stop();
    setRecOn(false);
    stopCamera();
    if (!alive()) return;
    if (noRep || !blob || !liftAt) {
      await wait(900);
      if (!alive()) return;
      setCommand(null); setPhase('norep'); setWaitLine(noRepLine(lift, lifter.division));
      return;
    }
    // Saved on the phone before anything is sent (3.10), so a reload or a lost signal keeps it.
    // by the corrected clock (item 86), so a slow phone clock can't put a lift before the close
    const savedAt = phoneNow();
    await savePending({ attemptId: attempt.id, blob, type: blob.type || recording.mimeType, commandTimes: ct, uploadId: null, savedAt, recordedAt: Math.round(savedAt - (performance.now() - recording.startedAt)) });
    freeze((lift === 'squat' && deeperOf(deepest)) || last);
    const clipUrl = URL.createObjectURL(blob);
    const replay = async () => {
      const rv = replayRef.current;
      if (!rv) return;
      rv.src = clipUrl;
      await within(readyToSeek(rv), 3000);
      await within(seekTo(rv, Math.max(0, rv.duration - 2)), 2000);
      setPhase('replay'); setReplaying(true); setFrozen(false);
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
    await awaitLights(alive, attempt.id, send(alive, attempt.id), (lift === 'squat' && deeperOf(deepest)) || last, replay, snapAt);
  }, [attempt.id, attempt.lift, attempt.reps_declared, home, lifter.division, stopCamera, awaitLights, send]);

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
    // The phone's judge finds the deepest frame and draws the marks, so it is waited for, as on
    // the camera path: without it the first sample of a session froze with no marks (look 9
    // step 10). Over 4 s, the slow line shows under the stage (3.11).
    const slowTimer = setTimeout(() => alive() && setSlow(true), 4000);
    const pose = await loadPoseModel().then(m => new LivePose(m), () => null);
    clearTimeout(slowTimer);
    if (!alive()) return;
    setSlow(false);
    const deepest = new DeepestFrames(d);
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
    let said = { squat: true, rack: false }, lastMedia = -1, rackShownAt = 0;
    await new Promise<void>(resolve => {
      const tick = () => {
        if (!alive()) return resolve();
        const ms = video.currentTime * 1000;
        if (said.squat) setRecSec(Math.floor((performance.now() - startAt) / 1000));
        if (pose && said.squat && !said.rack && video.currentTime !== lastMedia) {
          lastMedia = video.currentTime;
          deepest.offer({ t: ms, p: pose.detect(video) }, video);
        }
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
    // without the judge, the frame halfway from "Squat!" to "Rack!" stands in for the deepest
    let snap = deeperOf(deepest);
    if (!snap) {
      await seekTo(video, (ct.squat + ct.rack) / 2000).catch(() => {});
      snap = grab(video, d);
    }
    freeze(snap);
    const replay = async () => {
      await within(seekTo(video, Math.max(0, ct.rack / 1000 - 2)), 2000);
      setPhase('replay'); setReplaying(true); setFrozen(false);
      await video.play();
      await new Promise<void>(res => { const c = () => (!alive() || video.ended || video.currentTime >= ct.rack / 1000 ? res() : requestAnimationFrame(c)); requestAnimationFrame(c); });
      video.pause();
    };
    const snapAt = async (ms: number) => {
      await within(seekTo(video, ms / 1000), 2000);
      if (!pose) return grab(video, d);
      const one = new DeepestFrames(d);
      one.offer({ t: ms, p: pose.detect(video) }, video);
      return deeperOf(one) ?? grab(video, d);
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
    await awaitLights(alive, attempt.id, sent, null, async () => {}, snapAt);
  }, [attempt.id, send, awaitLights]);

  const start = (m: Mode) => {
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
  const go = (m: Mode) => {
    resetStage();
    setMode(m);
    setView('stage');
    audio();
    voiceRef.current!.unlock();
    void voiceRef.current!.load();
    requestAnimationFrame(() => {
      if (m === 'sample') void runSample();
      else if (m === 'resume') void runResume();
      else void runCamera(m === 'spot');
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
  const standIn = PLAN_SWITCHES.item75 && shownLift !== attempt.lift ? standInLine(shownLift, attempt.lift, lifter.division) : null;

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

  if (view === 'denied' || view === 'nocamera') {
    return (
      <div className="try-page meet-page"><main className="try-col meet-col" role="alert">
        {view === 'denied' ? (
          <>
            <h1 className="sheet-title">First Meet can&apos;t see your camera</h1>
            <p className="body">Android Chrome: Tap the icon left of the address, then Permissions, then Camera, Allow.</p>
            <p className="body">iPhone Safari: Tap aA in the address bar, then Website Settings, then Camera, Allow.</p>
          </>
        ) : <p className="body-l">This device has no camera we can use. Use a sample lift, or open First Meet on your phone.</p>}
        <div className="try-actions">
          {view === 'denied' && <button className="btn" type="button" onClick={() => start('lift')}>Try again</button>}
          <button className={`btn${view === 'denied' ? ' ghost' : ''}`} type="button" onClick={() => start('sample')}>Use a sample lift instead</button>
        </div>
      </main></div>
    );
  }

  if (view === 'card') {
    return (
      <div className={`try-page meet-page${item81 ? ' look-56' : ''}`}><main className="try-col meet-col">
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
        {item81 ? (
          <>
            {/* look 5.6: the Primary on its own, a direct child of the column, so it can dock */}
            <ReadyDock><button className="btn" type="button" onClick={() => start('lift')}>I&apos;m ready</button></ReadyDock>
            <div className="try-actions ready-links">
              <button className="link" type="button" onClick={() => start('sample')}>Use a sample lift instead</button>
              <button className="link" type="button" onClick={() => start('spot')}>Test your spot first</button>
            </div>
            {strip}
          </>
        ) : (
          <>
            {strip}
            <div className="try-actions">
              <button className="btn" type="button" onClick={() => start('lift')}>I&apos;m ready</button>
              <button className="link" type="button" onClick={() => start('sample')}>Use a sample lift instead</button>
              <button className="link" type="button" onClick={() => start('spot')}>Test your spot first</button>
            </div>
          </>
        )}
      </main></div>
    );
  }

  // The stage.
  const isSample = mode === 'sample';
  const box = containBox(stageSize, dims);
  const lifting = phase === 'spot' || phase === 'good-spot' || phase === 'loaded' || phase === 'lifting';
  const panelOpen = !lifting && !(phase === 'loading' && !slow && !error);
  const stageClass = ['stage',
    phase === 'spot' || phase === 'good-spot' ? 'spotting' : '',
    recOn ? 'recording' : '',
    phase === 'held' || phase === 'offline' || phase === 'close' ? 'judging' : '',
    phase === 'norep' ? 'norep' : '',
    phase === 'lit' || phase === 'replay' || phase === 'hold' ? 'lit' : '',
    frozen ? 'frozen' : '',
  ].filter(Boolean).join(' ');
  const k = dims ? box.width / dims.w : 1;
  const colour = phase === 'close' ? 'var(--stage-ink-2)' : result?.title === 'Good lift' ? 'var(--lamp-white)' : 'var(--lamp-red)';
  const recLabel = `REC ${Math.floor(recSec / 60)}:${String(recSec % 60).padStart(2, '0')}`;
  const waiting = phase === 'held' || phase === 'offline';
  const judged = phase === 'lit' || phase === 'replay' || phase === 'hold';
  const nextLabel = nextLabelProp ?? nextButton(attempt.lift, attempt.number, lifter.division);

  return (
    <div className="try-app meet-app">
      <section className={`try-stagecol${panelOpen ? '' : ' full'}`} aria-label={isSample ? 'Sample lift' : 'Your lift'}>
        <div className={stageClass} ref={stageRef}>
          <div className={`footage${isSample ? '' : ' mirror'}`} style={box}>
            <video ref={feedRef} className="feed" playsInline muted aria-hidden="true" hidden={replaying && !isSample} />
            <video ref={replayRef} className="feed replay" playsInline muted aria-hidden="true" hidden={!replaying || isSample} />
            <canvas ref={frozenRef} className="feed" aria-hidden="true" hidden={!frozen} />
            {marks && dims && (
              <svg className="marks" viewBox={`0 0 ${dims.w} ${dims.h}`} aria-hidden="true">
                <polyline points={marks.pts.map(q => `${q.x},${q.y}`).join(' ')} fill="none" stroke={colour} strokeWidth={2.5 / k} strokeDasharray={`${6 / k} ${5 / k}`} />
                {marks.pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={6 / k} fill={colour} />)}
              </svg>
            )}
          </div>
          <div className="vignette" />
          <div className="dim" />
          <div className={`spill${spill ? ` ${spill} on` : ''}`} />
          <div className="hud meet-hud">
            <button className="close" type="button" aria-label="Back to the attempt card" onClick={toCard} disabled={!lifting && phase !== 'loading' && phase !== 'spot-done' && phase !== 'norep'}><X weight="bold" /></button>
            <div className="meet-hud-text">
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
          <Lamps states={lamps} />
          <WaitLine text={waitLine} lineRef={waitLineRef} />
          <div className="command" aria-live="assertive">
            {command && <span key={command.text} className={`c ${command.kind === 'soft' ? 'soft hold' : 'on'}`}>{command.text}</span>}
          </div>
          {phase === 'spot' && line && <p className="spotline" aria-live="polite">{line}</p>}
          <div className="spotparts" aria-label="What the phone can see">
            {PARTS.map(p => <span key={p} className={parts[p] ? 'seen' : ''}>{p}</span>)}
          </div>
          <div className="rec" aria-hidden="true"><b /><span>{recLabel}</span></div>
          {!isSample && <div className={`cliptag${phase === 'replay' || (phase === 'hold' && frozen) ? ' on' : ''}`}>Your clip</div>}
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
                <button className="link" type="button" onClick={() => start('sample')}>Use a sample lift instead</button>
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
                  {phase === 'close' && demoReferee && <Link className="link" href={`/referee/demo/${attempt.id}`}>{MEET_WORDS.refereeLink}</Link>}
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
