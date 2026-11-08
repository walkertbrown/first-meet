'use client';
// Try a lift (plan 5.2): choose, set up, then the stage (look 9, steps 2–10).
// The judge runs on the phone, frame by frame, with the same TryALift machine the
// clip tests run. Her video never leaves the phone.
import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Lock, SpeakerHigh, SpeakerSlash, X } from '@phosphor-icons/react';
import { RULES, TryALift, type AttemptResult, type Dims, type Part } from '@/lib/judge';
import { Lamps, type LampState } from '@/components/lamps';
import { SetupDrawing } from '@/components/setup-drawings';
import { loadPoseModel, LivePose } from '@/lib/stage/pose-live';
import { Voice } from '@/lib/stage/voice';
import { thock, audio } from '@/lib/stage/thock';
import { SAMPLES, sampleOf, sampleSrc, type Sample } from '@/lib/stage/samples';
import { DeepestFrames, marksOf, type Marks } from '@/lib/stage/snap';
import { Recording, readyToSeek, seekTo, sleep, within } from '@/lib/stage/recorder';
import { makeClip, shareOrDownload } from '@/lib/stage/clip-maker';
import { RESULT_WORDS, STAGE_WORDS, lampsOf, markColour, outcomeOf, type Outcome } from '@/lib/stage/try-words';

type Step = 'choose' | 'setup' | 'stage' | 'denied' | 'nocamera';
type Source = { kind: 'camera' } | { kind: 'sample'; sample: Sample };
type Phase = 'loading' | 'intro' | 'spot' | 'good-spot' | 'stand-tall' | 'lifting' | 'norep' | 'judging' | 'lit' | 'replay' | 'hold';
type Command = { text: string; kind: 'soft' | 'on' } | null;

const PARTS: Part[] = ['head', 'hips', 'knees', 'feet'];
const NO_PARTS: Record<Part, boolean> = { head: false, hips: false, knees: false, feet: false };
/** Shown when a phone films the squat on its side (plan 3.10: a sideways phone never passes the frame check). */
const PORTRAIT_LINE = 'Stand your phone up tall on the floor, against a mug or a shoe.';
/** How long "Rack!" is on the stage before the frame freezes: its command keyframe. */
const RACK_SHOWN_MS = 900;
/** How long a sample's held last frame waits for "Rack!" before the lift is judged as seen. */
const SAMPLE_END_HOLD_MS = 1500;

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
/** Look's waits, shortened with motion off (as in sample.html). */
const wait = (ms: number) => sleep(reduced() ? Math.min(ms, 600) : ms);

function browserOf(): 'android' | 'ios' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return 'other';
}

/** The browser and its major version, from the user agent ("Chrome 142", "Safari 18"). */
function browserNameOf(ua: string): string {
  for (const [re, name] of [[/Edg\/(\d+)/, 'Edge'], [/SamsungBrowser\/(\d+)/, 'Samsung Internet'], [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'], [/CriOS\/(\d+)/, 'Chrome'], [/Chrome\/(\d+)/, 'Chrome'], [/Version\/(\d+).*Safari/, 'Safari']] as const) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1]}`;
  }
  return 'Other browser';
}

/**
 * Which phone judged the clip: the browser and the model (plan 2.4, the phone judge's time per
 * clip, by device). Nothing that names her.
 */
async function deviceOf(): Promise<string> {
  const ua = navigator.userAgent;
  const browser = browserNameOf(ua);
  const uad = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(k: string[]): Promise<{ model?: string; platform?: string; platformVersion?: string }> } }).userAgentData;
  try {
    if (uad) {
      const h = await uad.getHighEntropyValues(['model', 'platform', 'platformVersion']);
      const s = [h.platform, h.platformVersion?.split('.')[0], h.model].filter(Boolean).join(' ');
      if (s) return `${browser} · ${s}`.slice(0, 80);
    }
  } catch { /* fall through */ }
  const m = ua.match(/\(([^)]+)\)/)?.[1] ?? '';
  return `${browser} · ${m}`.slice(0, 80);
}

function reportJudgeTime(body: Record<string, unknown>) {
  void deviceOf().then(device => {
    const data = JSON.stringify({ ...body, device });
    try {
      if (!navigator.sendBeacon?.('/api/judge-time', new Blob([data], { type: 'application/json' }))) {
        void fetch('/api/judge-time', { method: 'POST', body: data, headers: { 'content-type': 'application/json' }, keepalive: true });
      }
    } catch { /* /ops just misses this one */ }
  });
}

/** The box a w×h picture fills inside the stage, uncropped (object-fit: contain). */
function containBox(stage: { w: number; h: number }, d: Dims | null) {
  if (!d || !stage.w || !stage.h) return { left: 0, top: 0, width: stage.w, height: stage.h };
  const k = Math.min(stage.w / d.w, stage.h / d.h);
  const width = d.w * k, height = d.h * k;
  return { left: (stage.w - width) / 2, top: (stage.h - height) / 2, width, height };
}

export function TryLift({ meetLine, voicePack }: { meetLine: string; voicePack: string }) {
  const [step, setStep] = useState<Step>('choose');
  const [source, setSource] = useState<Source>({ kind: 'camera' });
  const [sound, setSound] = useState(true);

  // the stage
  const [phase, setPhase] = useState<Phase>('loading');
  const [slow, setSlow] = useState(false);
  const [parts, setParts] = useState<Record<Part, boolean>>(NO_PARTS);
  const [line, setLine] = useState<string | null>(null);
  const [command, setCommand] = useState<Command>(null);
  const [recSec, setRecSec] = useState<number | null>(null);
  const [lamps, setLamps] = useState<LampState[]>(['off', 'off', 'off']);
  const [waitLine, setWaitLine] = useState('');
  const [spill, setSpill] = useState<'' | 'white' | 'red'>('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [resultOn, setResultOn] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [marks, setMarks] = useState<Marks | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [dims, setDims] = useState<Dims | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [clipState, setClipState] = useState<'idle' | 'making' | 'saved' | 'failed'>('idle');

  const stageRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLVideoElement>(null);
  const replayRef = useRef<HTMLVideoElement>(null);
  const frozenRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const voiceRef = useRef<Voice | null>(null);
  const runRef = useRef(0);
  const clipRef = useRef<{ input: Parameters<typeof makeClip>[0] | null; file: Promise<File> | null; wanted: boolean }>({ input: null, file: null, wanted: false });

  voiceRef.current ??= new Voice(voicePack);
  useEffect(() => { voiceRef.current!.on = sound; }, [sound]);

  // The model is cached by the service worker after the first load (plan 3.11).
  useEffect(() => {
    if ('serviceWorker' in navigator && location.protocol === 'https:') void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStageSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => () => { runRef.current++; stopCamera(); }, [stopCamera]);

  const resetStage = () => {
    setPhase('loading'); setSlow(false); setParts(NO_PARTS); setLine(null); setCommand(null); setRecSec(null);
    setLamps(['off', 'off', 'off']); setWaitLine(''); setSpill(''); setOutcome(null); setResultOn(false);
    setFrozen(false); setMarks(null); setReplaying(false); setClipState('idle');
    clipRef.current = { input: null, file: null, wanted: false };
  };

  /** Runs one attempt on the stage, from the frame check to the held frame. */
  const run = useCallback(async (src: Source) => {
    const my = ++runRef.current;
    const alive = () => runRef.current === my;
    const voice = voiceRef.current!;
    const video = feedRef.current!;
    const isSample = src.kind === 'sample';

    // 1. The picture: her camera, or the sample clip paused on its first frame.
    if (src.kind === 'camera') {
      if (!streamRef.current) {
        if (!navigator.mediaDevices?.getUserMedia) { setStep('nocamera'); return; }
        try {
          streamRef.current = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } },
            audio: false,
          });
        } catch (e) {
          const name = (e as DOMException).name;
          setStep(name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' ? 'nocamera' : 'denied');
          return;
        }
      }
      if (!alive()) return;
      video.removeAttribute('src');
      video.srcObject = streamRef.current;
    } else {
      stopCamera();
      video.srcObject = null;
      video.src = sampleSrc(src.sample);
      setPhase('intro');
    }
    video.muted = true;
    video.playsInline = true;
    if (video.readyState < 2) await new Promise(r => video.addEventListener('loadeddata', r, { once: true }));
    if (!alive()) return;
    if (src.kind === 'camera') await video.play().catch(() => {});
    else { video.pause(); await seekTo(video, 0); }
    const d: Dims = { w: video.videoWidth, h: video.videoHeight };
    setDims(d);

    // 2. The judge. Over 4 s, say so under the stage (plan 3.11).
    const slowTimer = setTimeout(() => alive() && setSlow(true), 4000);
    let pose: LivePose;
    try {
      pose = new LivePose(await loadPoseModel());
    } catch {
      clearTimeout(slowTimer);
      if (alive()) setSlow(true);
      return;
    }
    clearTimeout(slowTimer);
    if (!alive()) return;
    setSlow(false);
    setPhase('spot');

    const tal = new TryALift(d);
    const deepest = new DeepestFrames(d);
    const recording = new Recording();
    const t0 = performance.now();
    let lastMedia = -1, lastPaused = 0, recTimer: ReturnType<typeof setInterval> | null = null;
    let squatAt = 0, rackShownAt = 0, rackMedia = 0, poseAtSquat = 0, framesAtSquat = 0, endedAt: number | null = null;
    let result: AttemptResult | null = null, noRep = false;
    const sideways = () => !isSample && coarse() && video.videoWidth > video.videoHeight;

    // 3. The frame check, the commands and the lift, frame by frame.
    await new Promise<void>(resolve => {
      const done = () => { if (recTimer) clearInterval(recTimer); resolve(); };
      const tick = () => {
        if (!alive()) return done();
        const now = performance.now();
        if (video.paused) {
          if (now - lastPaused < 66) return void requestAnimationFrame(tick);
          lastPaused = now;
        } else if (video.currentTime === lastMedia) return void requestAnimationFrame(tick);
        lastMedia = video.currentTime;
        const t = now - t0;
        const turned = sideways();
        const p = turned ? null : pose.detect(video);
        const f = { t, p };
        if (tal.phase !== 'spot' && tal.phase !== 'done') deepest.offer(f, video);
        for (const ev of tal.feed(f)) {
          if (ev.type === 'spot') {
            setParts(cur => (PARTS.every(k => cur[k] === ev.spot.parts[k]) ? cur : ev.spot.parts));
            setLine(turned ? PORTRAIT_LINE : ev.spot.line);
          } else if (ev.type === 'good-spot') {
            setPhase('good-spot'); setLine(null); setParts({ head: true, hips: true, knees: true, feet: true });
            setCommand({ text: STAGE_WORDS.goodSpot, kind: 'soft' }); voice.say('good-spot');
          } else if (ev.type === 'stand-tall') {
            setPhase('stand-tall'); setCommand({ text: STAGE_WORDS.standTall, kind: 'soft' });
          } else if (ev.type === 'squat') {
            squatAt = now; poseAtSquat = pose.poseMs; framesAtSquat = pose.frames;
            setPhase('lifting'); setCommand({ text: STAGE_WORDS.squat, kind: 'on' }); voice.say('squat');
            // A sample holds its first frame (she stands still) until "Squat!", then plays: the
            // lifter in the clip squats on the command, as she will.
            if (isSample) void video.play();
            if (streamRef.current && !isSample) {
              recording.start(streamRef.current);
              setRecSec(0);
              recTimer = setInterval(() => setRecSec(Math.floor((performance.now() - squatAt) / 1000)), 250);
            }
          } else if (ev.type === 'rack') {
            rackMedia = video.currentTime; rackShownAt = now;
            setCommand({ text: STAGE_WORDS.rack, kind: 'on' }); voice.say('rack');
            noRep = ev.noRep;
          } else if (ev.type === 'result') {
            result = ev.result;
            return done();
          }
        }
        // A sample's last frame is held, as its first was, so a lifter who ends the clip
        // standing gets "Rack!" (rackStillMs of stillness). If no rack comes in 1.5 s, the
        // lift is judged on what was seen.
        if (isSample && video.ended && endedAt === null) endedAt = now;
        if (isSample && endedAt !== null && now - endedAt >= SAMPLE_END_HOLD_MS && tal.phase !== 'done') {
          const ev = tal.finish(t);
          rackMedia = video.currentTime;
          if (ev.type === 'result') result = ev.result;
          return done();
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (!alive()) return;
    const blob = isSample ? null : await recording.stop();
    if (isSample) video.pause();
    setRecSec(null);
    const r = result as AttemptResult | null;
    if (r) {
      reportJudgeTime({
        source: isSample ? 'sample' : 'camera',
        clipMs: Math.round(performance.now() - squatAt),
        poseMs: Math.round(pose.poseMs - poseAtSquat),
        frames: pose.frames - framesAtSquat,
        screenW: Math.round(screen.width), screenH: Math.round(screen.height),
        bytes: blob ? blob.size : null,
      });
    }

    // "Rack!" with no rep: the lamps stay dark (plan 5.2 step 3).
    if (noRep || !r || r.noRep) {
      await wait(900);
      if (!alive()) return;
      setCommand(null); setPhase('norep'); setWaitLine(STAGE_WORDS.noRep);
      return;
    }

    // 4. The held breath: the judged frame, "The judge is looking" for at least 1.2 s.
    const o = outcomeOf(r);
    const snap = deepest.get(r.side);
    const fc = frozenRef.current;
    if (snap && fc) {
      fc.width = snap.canvas.width; fc.height = snap.canvas.height;
      fc.getContext('2d')!.drawImage(snap.canvas, 0, 0);
    }
    const m = snap ? marksOf(snap.p, r.side, d) : null;
    // "Rack!" plays its whole keyframe (900 ms) before the frame freezes.
    await wait(rackShownAt ? Math.max(500, RACK_SHOWN_MS - (performance.now() - rackShownAt)) : 500);
    if (!alive()) return;
    const lookingAt = performance.now();
    setCommand(null); setFrozen(!!snap); setPhase('judging'); setWaitLine(STAGE_WORDS.looking);
    await sleep(Math.max(0, RULES.tryALift.judgeLookingMinMs - (performance.now() - lookingAt)));
    if (!alive()) return;

    // 5. The lights: 330 ms apart with the thock, the spill after the third, the result 420 ms later.
    const L = lampsOf(o);
    setOutcome(o);
    setWaitLine('');
    if (L.some(s => s !== 'off')) {
      for (let k = 0; k < 3; k++) {
        setLamps(L.map((s, j) => (j <= k ? s : 'off')));
        if (sound) thock(L[k] === 'red');
        if (k === 0) setPhase('lit');
        await wait(330);
        if (!alive()) return;
      }
      setSpill(o === 'good' ? 'white' : 'red');
    } else setPhase('lit');
    await wait(420);
    if (!alive()) return;
    setResultOn(true);

    if (blob && snap) {
      clipRef.current.input = { video: blob, judged: snap.canvas, marks: m, lamps: L, markColour: markColour(o), mirror: true };
    }

    // 6. Her clip: the last 2 seconds in real time, then the judged frame with the marks.
    await wait(900);
    if (!alive()) return;
    if (!reduced()) {
      const rv = isSample ? video : replayRef.current;
      try {
        if (!rv) throw new Error('no video');
        let from = 0, to = 0;
        if (isSample) { to = rackMedia; from = Math.max(0, to - 2); }
        else if (blob) {
          rv.src = URL.createObjectURL(blob);
          await within(readyToSeek(rv), 3000);
          to = rv.duration; from = Math.max(0, to - 2);
        } else throw new Error('no clip');
        await within(seekTo(rv, from), 2000);
        if (!alive()) return;
        setPhase('replay'); setReplaying(true); setFrozen(false);
        await rv.play();
        await new Promise<void>(res => {
          const check = () => (!alive() || rv.ended || rv.currentTime >= to - 0.03 ? res() : requestAnimationFrame(check));
          requestAnimationFrame(check);
        });
        rv.pause();
      } catch { /* no replay: straight to the hold */ }
      if (!alive()) return;
    }
    setReplaying(false); setFrozen(!!snap); setMarks(m); setPhase('hold');

    // Make her clip now, so "Save my clip" can open the share sheet straight from her tap.
    const input = clipRef.current.input;
    if (input) {
      clipRef.current.file = makeClip(input);
      clipRef.current.file.then(
        async file => {
          if (!alive() || !clipRef.current.wanted) return;
          const how = await shareOrDownload(file);
          if (alive()) setClipState(how === 'cancelled' ? 'idle' : 'saved');
        },
        () => { if (alive() && clipRef.current.wanted) setClipState('failed'); },
      );
    }
  }, [sound, stopCamera]);

  const startStage = (src: Source) => {
    resetStage();
    setSource(src);
    setStep('stage');
    // Sound and speech must start from her tap.
    audio();
    voiceRef.current!.unlock();
    void voiceRef.current!.load();
    requestAnimationFrame(() => void run(src));
  };

  const watchSample = (kind: Sample['kind'] = 'good') => {
    const s = sampleOf(kind) ?? SAMPLES[0];
    if (s) startStage({ kind: 'sample', sample: s });
  };

  const saveClip = async () => {
    const c = clipRef.current;
    if (!c.file || clipState === 'making') return;
    setClipState('making');
    c.wanted = true;
    // If it's already made, this opens the share sheet inside her tap. If not, the
    // promise in run() shares or downloads it when it's ready.
    const ready = await Promise.race([c.file.then(f => f, () => null), sleep(0).then(() => undefined)]);
    if (ready === undefined) return;
    c.wanted = false;
    if (!ready) { setClipState('failed'); return; }
    const how = await shareOrDownload(ready);
    setClipState(how === 'cancelled' ? 'idle' : 'saved');
  };

  const close = () => { runRef.current++; stopCamera(); };

  if (step === 'choose') {
    return (
      <div className="try-page">
        <header className="try-top"><Link href="/" className="try-close" aria-label="Close" onClick={close}><X weight="bold" /></Link></header>
        <main className="try-col">
          <h1 className="page-title">Try a lift</h1>
          <p className="body-l">One bodyweight squat. Your phone is the referee.</p>
          <div className="try-actions">
            <button className="btn" type="button" onClick={() => setStep('setup')}>Use my camera</button>
            <button className="btn ghost" type="button" onClick={() => watchSample('good')} disabled={!SAMPLES.length}>Watch a sample lift</button>
            <p className="small try-lock"><Lock weight="bold" className="icon" aria-hidden="true" />{"Your video stays on this phone. It's never uploaded."}</p>
          </div>
        </main>
      </div>
    );
  }

  if (step === 'setup') {
    return (
      <div className="try-page">
        <header className="try-top"><Link href="/" className="try-close" aria-label="Close" onClick={close}><X weight="bold" /></Link></header>
        <main className="try-col">
          <h1 className="sheet-title">Find your spot</h1>
          <ol className="try-steps">
            <li><SetupDrawing n={1} /><p className="body">Stand your phone up tall on the floor, against a mug or a shoe.</p></li>
            <li><SetupDrawing n={2} /><p className="body">Take two big steps back, side-on to the phone.</p></li>
            <li><SetupDrawing n={3} /><p className="body">Make sure the phone can see you from head to feet.</p></li>
          </ol>
          <div className="try-actions">
            <button className="btn" type="button" onClick={() => startStage({ kind: 'camera' })}>Open the camera</button>
            <div className="try-sound">
              <p className="small" id="sound-line">Sound on: your phone will call the commands out loud.</p>
              <label className="switch">
                <input type="checkbox" role="switch" checked={sound} onChange={e => setSound(e.target.checked)} aria-describedby="sound-line" />
                <span aria-hidden="true" />
                Sound
              </label>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (step === 'denied' || step === 'nocamera') {
    const b = browserOf();
    return (
      <div className="try-page">
        <header className="try-top"><Link href="/" className="try-close" aria-label="Close" onClick={close}><X weight="bold" /></Link></header>
        <main className="try-col" role="alert">
          {step === 'denied' ? (
            <>
              <h1 className="sheet-title">First Meet can&apos;t see your camera</h1>
              <p className="body-l">To judge your lift we need the camera. Nothing leaves your phone in Try a lift.</p>
              {b !== 'ios' && <p className="body">Android Chrome: Tap the icon left of the address, then Permissions, then Camera, Allow.</p>}
              {b !== 'android' && <p className="body">iPhone Safari: Tap aA in the address bar, then Website Settings, then Camera, Allow.</p>}
              <div className="try-actions">
                <button className="btn" type="button" onClick={() => startStage({ kind: 'camera' })}>Try again</button>
                <button className="btn ghost" type="button" onClick={() => watchSample('good')} disabled={!SAMPLES.length}>Watch a sample lift</button>
              </div>
            </>
          ) : (
            <>
              <p className="body-l">This device has no camera we can use. Watch a sample lift, or open First Meet on your phone.</p>
              <div className="try-actions">
                <button className="btn" type="button" onClick={() => watchSample('good')} disabled={!SAMPLES.length}>Watch a sample lift</button>
              </div>
            </>
          )}
        </main>
      </div>
    );
  }

  // The stage.
  const isSample = source.kind === 'sample';
  const words = outcome ? RESULT_WORDS[outcome] : null;
  const box = containBox(stageSize, dims);
  const lifting = phase === 'spot' || phase === 'good-spot' || phase === 'stand-tall' || phase === 'lifting';
  const panelOpen = !(lifting && !(isSample && phase !== 'lifting')) && !(phase === 'loading' && !slow);
  const stageClass = ['stage',
    phase === 'spot' ? 'spotting' : '',
    recSec !== null ? 'recording' : '',
    phase === 'judging' ? 'judging' : '',
    phase === 'lit' || phase === 'replay' || phase === 'hold' ? 'lit' : '',
    frozen ? 'frozen' : '',
    isSample && (phase === 'intro' || phase === 'spot' || phase === 'good-spot' || phase === 'stand-tall') ? 'held' : '',
  ].filter(Boolean).join(' ');
  const mirror = !isSample;
  const k = dims ? box.width / dims.w : 1;
  const colour = outcome ? markColour(outcome) : 'var(--stage-ink-2)';
  const recLabel = recSec !== null ? `REC ${Math.floor(recSec / 60)}:${String(recSec % 60).padStart(2, '0')}` : 'REC 0:00';

  return (
    <div className="try-app">
      <section className={`try-stagecol${panelOpen ? '' : ' full'}`} aria-label={isSample ? 'Sample lift' : 'Your lift'}>
        <div className={stageClass} ref={stageRef}>
          <div className={`footage${mirror ? ' mirror' : ''}`} style={box}>
            <video ref={feedRef} className="feed" playsInline muted aria-hidden="true" />
            <video ref={replayRef} className="feed replay" playsInline muted aria-hidden="true" hidden={!replaying || isSample} />
            <canvas ref={frozenRef} className="feed" aria-hidden="true" hidden={!frozen} />
            {isSample && <div className="held-dim" />}
            {marks && dims && (
              <svg className="marks" viewBox={`0 0 ${dims.w} ${dims.h}`} aria-hidden="true">
                <line x1={marks.hip.x} y1={marks.hip.y} x2={marks.knee.x} y2={marks.knee.y} stroke={colour} strokeWidth={2.5 / k} strokeDasharray={`${6 / k} ${5 / k}`} />
                <line
                  x1={marks.knee.x - (marks.knee.x >= marks.hip.x ? 70 : -70) / k} y1={marks.knee.y}
                  x2={marks.knee.x + (marks.knee.x >= marks.hip.x ? 20 : -20) / k} y2={marks.knee.y}
                  stroke={colour} strokeOpacity={0.45} strokeWidth={1.5 / k}
                />
                <circle cx={marks.hip.x} cy={marks.hip.y} r={6 / k} fill={colour} />
                <circle cx={marks.knee.x} cy={marks.knee.y} r={6 / k} fill={colour} />
              </svg>
            )}
          </div>
          <div className="vignette" />
          <div className="dim" />
          <div className={`spill${spill ? ` ${spill} on` : ''}`} />
          <div className="hud">
            <Link href="/" className="close" aria-label="Close" onClick={close}><X weight="bold" /></Link>
            <div className={`eyebrow try-what${isSample ? ' boxed' : ''}`}>{isSample ? 'Sample lift' : 'Try a lift'}</div>
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
          {!isSample && <div className={`cliptag${phase === 'replay' || phase === 'hold' ? ' on' : ''}`}>Your clip</div>}
          {source.kind === 'sample' && <div className="credit">{source.sample.credit}</div>}
        </div>

        <div className="panel" aria-hidden={!panelOpen}>
          <div className="panel-in">
            {slow && <p className="small">{STAGE_WORDS.slowModel}</p>}
            {source.kind === 'sample' && (phase === 'intro' || phase === 'spot' || phase === 'good-spot' || phase === 'stand-tall') && (
              <p className="small">This is a sample lift from {source.sample.credit}. Your own lift works the same way.</p>
            )}
            {phase === 'norep' && (
              <div className="try-actions">
                <button className="btn" type="button" onClick={() => startStage(source)}>Try again</button>
                <button className="btn ghost" type="button" onClick={() => watchSample('good')} disabled={!SAMPLES.length}>Watch a sample lift</button>
              </div>
            )}
            <div className="live" aria-live="polite">
              {phase === 'judging' && (
                <div className="breathe">
                  <p className="sheet-title">{STAGE_WORDS.breathe}</p>
                  <p className="body">{STAGE_WORDS.breatheBody}</p>
                </div>
              )}
              {words && phase !== 'judging' && (
                <div className={`result${resultOn ? ' on' : ''}${words?.reason ? ' no' : ''}`}>
                  {words && <h2>{words.title}</h2>}
                  {words?.body && <p className="main">{words.body}</p>}
                  {words?.reason && <div className="why"><b>{words.reason.label}</b><span>{words.reason.text}</span></div>}
                </div>
              )}
            </div>
            {resultOn && (
              <>
                <hr className="rule" />
                <p className="body">That&apos;s how every lift is judged at First Meet. <strong>{meetLine}</strong> Love Soo reads the totals live.</p>
                <div className="try-actions">
                  <Link className="btn" href="/join">Join the Winter meet</Link>
                  {isSample ? (
                    <>
                      {sampleOf('no') && <button className="btn ghost" type="button" onClick={() => watchSample('no')}>Watch a no lift</button>}
                      {sampleOf('good') && <button className="btn ghost" type="button" onClick={() => watchSample('good')}>Watch a good lift</button>}
                      <button className="btn ghost" type="button" onClick={() => setStep('setup')}>Try my own</button>
                    </>
                  ) : (
                    <>
                      <button className="btn ghost" type="button" onClick={() => startStage(source)}>Try again</button>
                      <button className="link" type="button" onClick={saveClip} aria-busy={clipState === 'making'} disabled={phase !== 'hold' || !clipRef.current.file}>
                        {clipState === 'making' ? 'Making your clip' : clipState === 'saved' ? 'Clip saved' : 'Save my clip'}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
