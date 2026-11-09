'use client';
// One meet attempt (plan 5.25, look 9 steps 1–11), as the demo meet runs it in phase 2: the
// attempt card, the stage, the commands, the recording saved on the phone and sent to R2, the
// held breath while Render judges it, and the lights as they land. A sample lift (5.36) runs the
// same server path; the phone only plays the clip.
import Link from 'next/link';
import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { SpeakerHigh, SpeakerSlash, X } from '@phosphor-icons/react';
import { TryALift, type Dims, type Part } from '@/lib/judge';
import { Lamps, type LampState } from '@/components/lamps';
import { BarDiagram, BellDiagram } from '@/components/bar-diagram';
import { loadPoseModel, LivePose } from '@/lib/stage/pose-live';
import { Voice, type VoiceKey } from '@/lib/stage/voice';
import { thock, audio } from '@/lib/stage/thock';
import { DeepestFrames, marksOf, type Marks, type Snap } from '@/lib/stage/snap';
import { Recording, readyToSeek, seekTo, sleep, within } from '@/lib/stage/recorder';
import { STAGE_WORDS } from '@/lib/stage/try-words';
import { MEET_WORDS, REFUSED_WORDS, barLoading, hudLine, meetResult, sampleRepsLine, weightDigits, type MeetResult } from '@/lib/stage/meet-words';
import { keepSending, getPending, savePending, type UploadStatus } from '@/lib/stage/uploader';
import samples from '../../content/samples/samples.json';

export type MeetAttemptProps = {
  attempt: { id: string; lift: string; number: number; weight: number; reps_declared: number | null; status: string };
  lifter: { cardName: string; ageGroup: string | null; division: 'barbell' | 'home'; units: 'lb' | 'kg' };
  /** The because line (5.25 step 1), worked out on the server. */
  because: string;
  voicePack: string;
};

type View = 'card' | 'stage' | 'denied' | 'nocamera' | 'limit';
type Mode = 'lift' | 'spot' | 'sample' | 'resume';
type Phase = 'loading' | 'spot' | 'good-spot' | 'spot-done' | 'loaded' | 'lifting' | 'norep' | 'held' | 'lit' | 'close' | 'replay' | 'hold' | 'offline' | 'refused';
type Command = { text: string; kind: 'soft' | 'on' } | null;
type State = { status: string; call: 'white' | 'red' | 'close' | null; lights: ('white' | 'red')[] | null; reason: string | null; red_rep: number | null; reps_declared: number | null; wait_minutes: number | null; judged_frame_ms?: number | null };
type SampleClip = { id: string; file: string; credit: string; meet?: { reps: number; command_times: Record<string, number> } };

const PARTS: Part[] = ['head', 'hips', 'knees', 'feet'];
const NO_PARTS: Record<Part, boolean> = { head: false, hips: false, knees: false, feet: false };
/** "Bar is loaded." is held for 1.5 s on a sample's first frame (look 9 step 4). */
const SOFT_HOLD_MS = 1500;
/** Recording stops this long after "Rack!" (3.10). */
const AFTER_RACK_MS = 1500;
/** A Home set is cut off at 90 s (3.10). */
const HOME_CAP_MS = 90_000;
const SENDING_MIN_MS = 1300;
const SLOW_UPLOAD_MS = 20_000;
const POLL_MS = 5000;

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => sleep(reduced() ? Math.min(ms, 600) : ms);
const LIFT_NAMES: Record<string, { barbell: string; home: string }> = {
  squat: { barbell: 'SQUAT', home: 'GOBLET SQUAT' }, bench: { barbell: 'BENCH', home: 'FLOOR PRESS' }, deadlift: { barbell: 'DEADLIFT', home: 'DEADLIFT' },
};

function containBox(stage: { w: number; h: number }, d: Dims | null) {
  if (!d || !stage.w || !stage.h) return { left: 0, top: 0, width: stage.w, height: stage.h };
  const k = Math.min(stage.w / d.w, stage.h / d.h);
  const width = d.w * k, height = d.h * k;
  return { left: (stage.w - width) / 2, top: (stage.h - height) / 2, width, height };
}

async function getJson(path: string, init?: RequestInit) {
  const r = await fetch(path, { credentials: 'same-origin', ...init });
  return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
}

export function MeetAttempt({ attempt: first, lifter, because, voicePack }: MeetAttemptProps) {
  const [attempt, setAttempt] = useState(first);
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
  const [marks, setMarks] = useState<Marks | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [dims, setDims] = useState<Dims | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [sample, setSample] = useState<{ credit: string; reps: number } | null>(null);
  const [again, setAgain] = useState(false);
  const [error, setError] = useState('');

  const stageRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLVideoElement>(null);
  const replayRef = useRef<HTMLVideoElement>(null);
  const frozenRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const voiceRef = useRef<Voice | null>(null);
  const runRef = useRef(0);
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
    setFrozen(false); setMarks(null); setReplaying(false); setSample(null); setError('');
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
    const t90 = setTimeout(async () => {
      await check(true);
      const n = (state as State | null)?.wait_minutes;
      if (alive() && n) { setWaitLine(MEET_WORDS.busy90(n)); setBusy(true); }
    }, Math.max(0, 90_000 - (performance.now() - t0)));
    const stop = () => { es?.close(); clearInterval(poll); clearTimeout(t45); clearTimeout(t90); };
    const next = () => new Promise<void>(res => { wake = res; });

    try {
      await check();
      let pulsing = false;
      for (;;) {
        if (!alive()) return;
        const s = state as State | null;
        if (s?.call === 'close' && !pulsing) {
          pulsing = true;
          clearTimeout(t45); clearTimeout(t90);
          setLamps(['pulse', 'pulse', 'pulse']); setWaitLine('A referee is looking at this one');
          setResult(meetResult({ ...s, lift: attempt.lift })); setPhase('close'); setResultOn(true);
        }
        if (s && (s.call === 'white' || s.call === 'red')) break;
        await next();
      }
      stop();
      const s = state as unknown as State;
      const res = meetResult({ ...s, lift: attempt.lift })!;
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
      if (judged?.p.length) setMarks(marksOf(judged.p, judged.side, { w: judged.canvas.width, h: judged.canvas.height }));
      setPhase('hold');
    } finally { stop(); }
  }, [attempt.lift]);

  /** Sends the saved recording, telling the stage how it goes; resolves once the server has it. */
  const send = useCallback((alive: () => boolean, attemptId: string) => {
    const started = performance.now();
    const slowT = setTimeout(() => alive() && setSlowUpload(true), SLOW_UPLOAD_MS);
    return new Promise<boolean>(resolve => {
      const onStatus = (s: UploadStatus) => {
        if (!alive()) return;
        if (s.kind === 'offline') setPhase('offline');
        else if (s.kind === 'sending' || s.kind === 'retrying') setPhase(p => (p === 'offline' ? 'held' : p));
      };
      void keepSending(attemptId, onStatus).done.then(s => {
        clearTimeout(slowT);
        if (!alive()) return resolve(false);
        setSlowUpload(false);
        if (s.kind === 'sent') { setPhase('held'); return resolve(true); }
        if (s.kind === 'limit') { setLimit(s.limit); setView('limit'); return resolve(false); }
        if (s.kind === 'refused') console.warn('upload refused', s.error);
        setPhase('refused'); resolve(false);
      });
      void started;
    });
  }, []);

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

    const declared = attempt.reps_declared ?? undefined;
    const tal = new TryALift(d, { reps: declared });
    const deepest = new DeepestFrames(d);
    const recording = new Recording(home ? 1_500_000 : 2_500_000);
    const ct: Record<string, number> = {};
    const t0 = performance.now();
    let lastMedia = -1, recTimer: ReturnType<typeof setInterval> | null = null, squatAt = 0, rackAt = 0, noRep = false, spotDone = false;
    const since = () => Math.round(performance.now() - recording.startedAt);

    await new Promise<void>(resolve => {
      const done = () => { if (recTimer) clearInterval(recTimer); resolve(); };
      const tick = () => {
        if (!alive()) return done();
        const now = performance.now();
        if (video.currentTime === lastMedia) return void requestAnimationFrame(tick);
        lastMedia = video.currentTime;
        const f = { t: now - t0, p: pose.detect(video) };
        if (tal.phase !== 'spot' && tal.phase !== 'done') deepest.offer(f, video);
        for (const ev of tal.feed(f)) {
          if (ev.type === 'spot') { setParts(cur => (PARTS.every(k => cur[k] === ev.spot.parts[k]) ? cur : ev.spot.parts)); setLine(ev.spot.line); }
          else if (ev.type === 'good-spot') {
            setPhase('good-spot'); setLine(null); setParts({ head: true, hips: true, knees: true, feet: true });
            setCommand({ text: STAGE_WORDS.goodSpot, kind: 'soft' }); voice.say('good-spot');
            if (spotOnly) { spotDone = true; return done(); }
          } else if (ev.type === 'stand-tall') {
            // 5.25 step 4: the soft command; the recording starts here, so it is 0 in command_times
            setPhase('loaded'); setCommand({ text: home ? MEET_WORDS.soft.home : MEET_WORDS.soft.barbell, kind: 'soft' });
            voice.say(home ? 'weights-ready' : 'bar-loaded');
            if (streamRef.current) recording.start(streamRef.current);
            ct.loaded = 0;
          } else if (ev.type === 'squat') {
            squatAt = now; ct.squat = since();
            flushSync(() => { setPhase('lifting'); setCommand({ text: MEET_WORDS.squat, kind: 'on' }); setRecSec(0); setRecOn(true); });
            voice.say('squat');
            recTimer = setInterval(() => setRecSec(Math.floor((performance.now() - squatAt) / 1000)), 250);
          } else if (ev.type === 'rep') {
            if (declared) { ct[`rep_${ev.k}`] = since(); setReps(ev.k); if (ev.k <= 20) voice.say(`count-${ev.k}` as VoiceKey); }
          } else if (ev.type === 'rack') {
            rackAt = now; ct.rack = since(); noRep = ev.noRep;
            setCommand({ text: MEET_WORDS.rack, kind: 'on' }); voice.say('rack');
          } else if (ev.type === 'result') return done();
        }
        if (home && squatAt && now - squatAt > HOME_CAP_MS && tal.phase !== 'done') {
          // 90 s is the most a Home set can run: "Rack!" now, on what was seen
          rackAt = now; ct.rack = since();
          setCommand({ text: MEET_WORDS.rack, kind: 'on' }); voice.say('rack');
          tal.finish(f.t);
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
    // 3.10: recording stops 1.5 s after "Rack!"
    await sleep(Math.max(0, rackAt + AFTER_RACK_MS - performance.now()));
    const blob = await recording.stop();
    setRecOn(false);
    stopCamera();
    if (!alive()) return;
    if (noRep || !blob || !tal.result || tal.result.noRep || ct.squat === undefined) {
      await wait(900);
      if (!alive()) return;
      setCommand(null); setPhase('norep'); setWaitLine(MEET_WORDS.noRep);
      return;
    }
    // Saved on the phone before anything is sent (3.10), so a reload or a lost signal keeps it.
    await savePending({ attemptId: attempt.id, blob, type: blob.type || recording.mimeType, commandTimes: ct, uploadId: null, savedAt: Date.now() });
    const snap = deeperOf(deepest, tal.result.side);
    freeze(snap);
    const replay = async () => {
      const rv = replayRef.current;
      if (!rv) return;
      rv.src = URL.createObjectURL(blob);
      await within(readyToSeek(rv), 3000);
      await within(seekTo(rv, Math.max(0, rv.duration - 2)), 2000);
      setPhase('replay'); setReplaying(true); setFrozen(false);
      await rv.play();
      await new Promise<void>(res => { const c = () => (!alive() || rv.ended ? res() : requestAnimationFrame(c)); requestAnimationFrame(c); });
      rv.pause();
    };
    await awaitLights(alive, attempt.id, send(alive, attempt.id), snap, replay);
  }, [attempt.id, attempt.reps_declared, home, stopCamera, awaitLights, send]);

  /** "Use a sample lift instead" (5.36): the server copies and queues the clip; the phone plays it. */
  const runSample = useCallback(async () => {
    const my = ++runRef.current;
    const alive = () => runRef.current === my;
    const voice = voiceRef.current!;
    const r = await getJson('/api/demo/sample', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attempt_id: attempt.id }) }).catch(() => null);
    if (!alive()) return;
    if (r?.status === 429) { setLimit((r.body.limit as 'lifter' | 'everyone') ?? 'lifter'); setView('limit'); return; }
    if (r?.status !== 200) { console.warn('sample refused', r?.status, r?.body.error); setPhase('refused'); return; }
    const picked = r.body.sample as { id: string; credit: string; reps: number };
    const clip = (samples.clips as SampleClip[]).find(c => c.id === picked.id);
    setSample({ credit: picked.credit, reps: picked.reps });
    const ct = clip?.meet?.command_times ?? { loaded: 0, squat: 200, rack: 4000 };
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
    // the phone finds the deepest frame for the frozen picture, if its judge is ready in time
    const pose = await within(loadPoseModel(), 4000).then(m => new LivePose(m), () => null);
    if (!alive()) return;
    const deepest = new DeepestFrames(d);
    setPhase('loaded'); setCommand({ text: home ? MEET_WORDS.soft.home : MEET_WORDS.soft.barbell, kind: 'soft' });
    voice.say(home ? 'weights-ready' : 'bar-loaded');
    await wait(SOFT_HOLD_MS);
    if (!alive()) return;
    void video.play();
    let said = { squat: false, rack: false }, startAt = performance.now(), lastMedia = -1;
    await new Promise<void>(resolve => {
      const tick = () => {
        if (!alive()) return resolve();
        const ms = video.currentTime * 1000;
        if (!said.squat && ms >= ct.squat) {
          said = { ...said, squat: true }; startAt = performance.now();
          flushSync(() => { setPhase('lifting'); setCommand({ text: MEET_WORDS.squat, kind: 'on' }); setRecSec(0); setRecOn(true); });
          voice.say('squat');
        }
        if (said.squat) setRecSec(Math.floor((performance.now() - startAt) / 1000));
        if (pose && said.squat && !said.rack && video.currentTime !== lastMedia) {
          lastMedia = video.currentTime;
          deepest.offer({ t: ms, p: pose.detect(video) }, video);
        }
        if (!said.rack && (ms >= ct.rack || video.ended)) {
          said = { ...said, rack: true };
          setCommand({ text: MEET_WORDS.rack, kind: 'on' }); voice.say('rack');
        }
        if (said.rack && (video.ended || ms >= ct.rack + AFTER_RACK_MS)) return resolve();
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
    await awaitLights(alive, attempt.id, sent, null, async () => {});
  }, [attempt.id, send, awaitLights]);

  const start = (m: Mode) => {
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
    if (startView === 'stage') requestAnimationFrame(() => void runResume());
    // only on the first render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toCard = () => { runRef.current++; stopCamera(); resetStage(); setView('card'); };

  /** Phase 2 has only the first attempt: "Lift it again" makes a fresh one. */
  const liftAgain = async () => {
    setAgain(true);
    const r = await getJson('/api/demo/again', { method: 'POST' }).catch(() => null);
    setAgain(false);
    if (r?.status === 200) {
      const a = r.body.attempt as { id: string; lift: string; number: number; weight: number; repsDeclared: number | null; status: string };
      setAttempt({ id: a.id, lift: a.lift, number: a.number, weight: a.weight, reps_declared: a.repsDeclared, status: a.status });
      toCard();
    }
  };

  const liftName = (LIFT_NAMES[attempt.lift] ?? LIFT_NAMES.squat)[lifter.division];
  const ofLine = `Attempt ${attempt.number} of 3`;
  const loading = home ? `One ${attempt.weight} ${lifter.units} dumbbell` : barLoading(attempt.weight, lifter.units);

  if (view === 'limit') {
    return (
      <div className="try-page meet-page"><main className="try-col meet-col" role="alert">
        <p className="body-l">{MEET_WORDS.limit[limit]}</p>
        <div className="try-actions"><Link className="btn ghost" href="/sample">Watch a meet night</Link></div>
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
      <div className="try-page meet-page"><main className="try-col meet-col">
        <article className="attempt-card" aria-label={`${liftName}, ${ofLine}`}>
          <div className="ac-row1">
            <h1 className="lift-name">{home ? `${liftName} · ${ofLine}` : liftName}</h1>
            {!home && <span className="body ac-of">{ofLine}{attempt.number === 1 && <span className="ac-opener"> · opener</span>}</span>}
          </div>
          <p className="weight-xl num" style={{ '--digits': weightDigits(home ? attempt.reps_declared ?? 0 : attempt.weight) } as React.CSSProperties}>
            {home ? attempt.reps_declared : attempt.weight}<span className="unit">{home ? 'reps' : lifter.units}</span>
          </p>
          {home ? <BellDiagram label={loading} /> : <BarDiagram weight={attempt.weight} units={lifter.units} label={loading} />}
          <p className="small">{loading}</p>
          <p className="body ac-because">{because}</p>
        </article>
        <div className="try-actions">
          <button className="btn" type="button" onClick={() => start('lift')}>I&apos;m ready</button>
          <button className="link" type="button" onClick={() => start('sample')}>Use a sample lift instead</button>
          <button className="link" type="button" onClick={() => start('spot')}>Test your spot first</button>
        </div>
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
                <line x1={marks.hip.x} y1={marks.hip.y} x2={marks.knee.x} y2={marks.knee.y} stroke={colour} strokeWidth={2.5 / k} strokeDasharray={`${6 / k} ${5 / k}`} />
                <circle cx={marks.hip.x} cy={marks.hip.y} r={6 / k} fill={colour} />
                <circle cx={marks.knee.x} cy={marks.knee.y} r={6 / k} fill={colour} />
              </svg>
            )}
          </div>
          <div className="vignette" />
          <div className="dim" />
          <div className={`spill${spill ? ` ${spill} on` : ''}`} />
          <div className="hud meet-hud">
            <button className="close" type="button" aria-label="Back to the attempt card" onClick={toCard} disabled={!lifting && phase !== 'loading' && phase !== 'spot-done' && phase !== 'norep'}><X weight="bold" /></button>
            <div className="meet-hud-text">
              <div className="eyebrow">{`${(LIFT_NAMES[attempt.lift] ?? LIFT_NAMES.squat).barbell} · ${attempt.number} OF 3`}</div>
              {isSample && <div className="eyebrow try-what boxed">Sample lift</div>}
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
          <div className={`waitline${waitLine ? ' on' : ''}`} aria-live="polite">{waitLine}</div>
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
              </div>
            )}
            {phase === 'refused' && (
              <div role="alert">
                <p className="sheet-title">{REFUSED_WORDS.title}</p>
                <p className="body">{REFUSED_WORDS.body}</p>
                <div className="try-actions"><button className="btn" type="button" onClick={liftAgain} aria-busy={again}>Lift it again</button></div>
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
                </div>
              )}
            </div>
            {(phase === 'close' || (judged && resultOn)) && (
              <div className="after">
                <hr className="rule" />
                <div className="try-actions">
                  {phase === 'close' && <Link className="link" href={`/referee/demo/${attempt.id}`}>{MEET_WORDS.refereeLink}</Link>}
                  {judged && <button className="btn" type="button" onClick={liftAgain} aria-busy={again} disabled={again}>Lift it again</button>}
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
