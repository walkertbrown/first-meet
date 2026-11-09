'use client';
// "Test your spot" (plan 5.23): the frame check alone, with the front camera, the same words and
// segments as the attempt's step 3. Nothing is recorded or sent. Done: "Good spot. You're ready."
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import type { Dims, Part } from '@/lib/judge';
import { FrameCheck, type SpotLine } from '@/lib/judge/frame-check';
import { loadPoseModel, LivePose } from '@/lib/stage/pose-live';
import { STAGE_WORDS } from '@/lib/stage/try-words';

const PARTS: Part[] = ['head', 'hips', 'knees', 'feet'];
const NO_PARTS: Record<Part, boolean> = { head: false, hips: false, knees: false, feet: false };

function containBox(stage: { w: number; h: number }, d: Dims | null) {
  if (!d || !stage.w || !stage.h) return { left: 0, top: 0, width: stage.w, height: stage.h };
  const k = Math.min(stage.w / d.w, stage.h / d.h);
  const width = d.w * k, height = d.h * k;
  return { left: (stage.w - width) / 2, top: (stage.h - height) / 2, width, height };
}

type View = 'stage' | 'denied' | 'nocamera';
type Phase = 'loading' | 'spot' | 'good-spot' | 'done';

export function SpotCheck({ back }: { back: { href: string; label: string } }) {
  const [view, setView] = useState<View>('stage');
  const [phase, setPhase] = useState<Phase>('loading');
  const [parts, setParts] = useState(NO_PARTS);
  const [line, setLine] = useState<SpotLine | null>(null);
  const [slow, setSlow] = useState(false);
  const [dims, setDims] = useState<Dims | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef(0);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStageSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  const run = useCallback(async () => {
    const my = ++runRef.current;
    const alive = () => runRef.current === my;
    setView('stage'); setPhase('loading'); setParts(NO_PARTS); setLine(null);
    if (!navigator.mediaDevices?.getUserMedia) { setView('nocamera'); return; }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } }, audio: false });
    } catch (e) {
      const name = (e as DOMException).name;
      setView(name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' ? 'nocamera' : 'denied');
      return;
    }
    if (!alive()) return stopCamera();
    const video = feedRef.current!;
    video.srcObject = streamRef.current;
    video.muted = true; video.playsInline = true;
    if (video.readyState < 2) await new Promise(r => video.addEventListener('loadeddata', r, { once: true }));
    await video.play().catch(() => {});
    if (!alive()) return;
    const d: Dims = { w: video.videoWidth, h: video.videoHeight };
    setDims(d);
    const slowTimer = setTimeout(() => alive() && setSlow(true), 4000);
    let pose: LivePose;
    try { pose = new LivePose(await loadPoseModel()); } catch { clearTimeout(slowTimer); if (alive()) setSlow(true); return; }
    clearTimeout(slowTimer);
    if (!alive()) return;
    setSlow(false); setPhase('spot');
    const check = new FrameCheck(d);
    const t0 = performance.now();
    let lastMedia = -1;
    await new Promise<void>(resolve => {
      const tick = () => {
        if (!alive()) return resolve();
        if (video.currentTime === lastMedia) return void requestAnimationFrame(tick);
        lastMedia = video.currentTime;
        const spot = check.feed({ t: performance.now() - t0, p: pose.detect(video) });
        setParts(cur => (PARTS.every(k => cur[k] === spot.parts[k]) ? cur : spot.parts));
        setLine(spot.line);
        if (check.passed) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (!alive()) return;
    setPhase('good-spot'); setLine(null); setParts({ head: true, hips: true, knees: true, feet: true });
    await new Promise(r => setTimeout(r, 900));
    if (!alive()) return;
    stopCamera(); setPhase('done');
  }, [stopCamera]);

  useEffect(() => {
    void run();
    // the run counter, not a node: bumping it ends the running check
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { runRef.current++; stopCamera(); };
  }, [run, stopCamera]);

  if (view === 'denied' || view === 'nocamera') {
    return (
      <div className="try-page meet-page"><main className="try-col meet-col" role="alert">
        {view === 'denied' ? (
          <>
            <h1 className="sheet-title">First Meet can&apos;t see your camera</h1>
            <p className="body">Android Chrome: Tap the icon left of the address, then Permissions, then Camera, Allow.</p>
            <p className="body">iPhone Safari: Tap aA in the address bar, then Website Settings, then Camera, Allow.</p>
          </>
        ) : <p className="body-l">This device has no camera we can use. Open First Meet on your phone to test your spot.</p>}
        <div className="try-actions">
          {view === 'denied' && <button className="btn" type="button" onClick={() => void run()}>Try again</button>}
          <Link className={`btn${view === 'denied' ? ' ghost' : ''}`} href={back.href}>{back.label}</Link>
        </div>
      </main></div>
    );
  }

  const box = containBox(stageSize, dims);
  const panelOpen = phase === 'done' || slow;
  return (
    <div className="try-app meet-app">
      <section className={`try-stagecol${panelOpen ? '' : ' full'}`} aria-label="Test your spot">
        <div className={`stage${phase === 'spot' || phase === 'good-spot' ? ' spotting' : ''}`} ref={stageRef}>
          <div className="footage mirror" style={box}>
            <video ref={feedRef} className="feed" playsInline muted aria-hidden="true" />
          </div>
          <div className="vignette" />
          <div className="dim" />
          <div className="hud meet-hud">
            <Link className="close" href={back.href} aria-label={back.label}><X weight="bold" /></Link>
            <div className="meet-hud-text"><div className="eyebrow">Test your spot</div></div>
          </div>
          <div className="command" aria-live="assertive">
            {(phase === 'good-spot' || phase === 'done') && <span className="c soft hold">{STAGE_WORDS.goodSpot}</span>}
          </div>
          {phase === 'spot' && line && <p className="spotline" aria-live="polite">{line}</p>}
          <div className="spotparts" aria-label="What the phone can see">
            {PARTS.map(p => <span key={p} className={parts[p] ? 'seen' : ''}>{p}</span>)}
          </div>
        </div>
        <div className="panel" aria-hidden={!panelOpen}>
          <div className="panel-in">
            {slow && phase !== 'done' && <p className="small">{STAGE_WORDS.slowModel}</p>}
            {phase === 'done' && (
              <>
                <p className="sheet-title">Good spot. You&apos;re ready.</p>
                <div className="try-actions"><Link className="btn" href={back.href}>{back.label}</Link></div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
