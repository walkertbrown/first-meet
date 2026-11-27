'use client';
// "YOUR BEST LIFT" on the bomb-out page (plan 5.28, item 101; look 9 "The bomb-out clip"): her best good lift's
// clip as a 9:16 thumbnail that plays in place, with sound, only when she taps it. Share sends only the file
// (Web Share, or the download), and Save to my phone is the download: a bomb-out has no card link, and
// nothing here makes anything public. While it's being made the frame says so, with no buttons; if it couldn't
// be made, "Try again" once (item 102), then "We've told the team."
import { useEffect, useRef, useState } from 'react';
import { Play } from '@phosphor-icons/react';
import { BEST_LIFT_WORDS as W } from '@/lib/card/best-lift-words';

type Props = {
  ready: boolean;
  failed: null | 'retry' | 'final';
  /** "0:14" */
  length: string;
  /** look 9's words for a screen reader: "<Name>'s best lift: deadlift, attempt 2, 155 lb, three white lights." */
  label: string;
};

const CLIP = '/api/me/best-lift/clip.mp4';
const POSTER = '/api/me/best-lift/poster.jpg';

export function BestLiftClip({ ready: ready0, failed: failed0, length, label }: Props) {
  const [ready, setReady] = useState(ready0);
  const [failed, setFailed] = useState(failed0);
  // it came in while she was here: the poster and the buttons open in, once
  const [arrived, setArrived] = useState(false);
  const [opening, setOpening] = useState(false);
  const [poster, setPoster] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sharing, setSharing] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const img = useRef<HTMLImageElement>(null);

  // the poster can finish loading before React is listening, and then onLoad never comes
  useEffect(() => { const i = img.current; if (i?.complete && i.naturalWidth > 0) setPoster(true); }, [ready]);

  // about a minute: look again every 8 s until it's made or couldn't be
  useEffect(() => {
    if (ready || failed) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch('/api/me/best-lift', { cache: 'no-store' });
        const j = r.ok ? await r.json() as { ready?: boolean; failed?: null | 'retry' | 'final' } : null;
        if (j?.ready) { setArrived(true); setOpening(true); setReady(true); } else if (j?.failed) setFailed(j.failed);
      } catch { /* try again */ }
    }, 8000);
    return () => clearInterval(t);
  }, [ready, failed]);

  // Web Share needs the file in hand when she taps, so it's fetched once the clip is there
  useEffect(() => {
    if (!ready) return;
    let gone = false;
    (async () => {
      try {
        const r = await fetch(CLIP);
        if (!r.ok) return;
        const b = await r.blob();
        if (!gone) setFile(new File([b], 'first-meet-best-lift.mp4', { type: 'video/mp4' }));
      } catch { /* Share downloads instead */ }
    })();
    return () => { gone = true; };
  }, [ready]);

  const tryAgain = async () => {
    setFailed(null);
    try {
      const r = await fetch('/api/me/best-lift', { method: 'POST' });
      if (!r.ok) {
        const g = await fetch('/api/me/best-lift', { cache: 'no-store' });
        const j = g.ok ? await g.json() as { ready?: boolean; failed?: null | 'retry' | 'final' } : null;
        if (j?.ready) setReady(true); else setFailed(j?.failed ?? 'retry');
      }
    } catch { setFailed('retry'); }
  };

  const play = () => {
    const v = video.current;
    if (!v) return;
    // from the start the first time and from the end frame; a pause picks up where it was
    if (!started || v.ended) v.currentTime = 0;
    setStarted(true);
    v.muted = false;
    void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const download = () => {
    const a = document.createElement('a');
    a.href = `${CLIP}?download=1`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const share = async () => {
    if (sharing) return;
    if (file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      setSharing(true);
      try {
        await navigator.share({ files: [file] });
      } catch (e) {
        // she closed the share sheet: nothing was shared
        if ((e as Error)?.name !== 'AbortError') download();
      } finally { setSharing(false); }
      return;
    }
    download();
  };

  const state = ready ? 'ready' : failed ? 'failed' : 'making';
  return (
    <section className="best-lift" aria-labelledby="best-lift-eyebrow">
      <h2 className="eyebrow" id="best-lift-eyebrow">{W.eyebrow}</h2>
      <div className={`best-frame ${state}${arrived ? ' arrived' : ''}`} data-state={state}>
        {state === 'making' && <p className="small best-in" role="status">{W.making}</p>}
        {state === 'failed' && (
          <div className="best-in" role="status">
            <p className="sheet-title">{W.failedTitle}</p>
            <p className="body">{failed === 'final' ? W.failedFinal : W.failedBody}</p>
          </div>
        )}
        {state === 'ready' && <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={img} className={`best-poster${poster ? ' on' : ''}`} src={POSTER} alt="" onLoad={() => setPoster(true)} hidden={started} />
          <video ref={video} className="best-video" src={CLIP} playsInline preload="none" controls={playing}
            hidden={!started} aria-label={label}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
          {!playing && (
            <button type="button" className="best-play" aria-label={W.play} aria-describedby="best-lift-label" onClick={play}>
              {!started && <span className="best-tag"><Play size={24} weight="bold" aria-hidden="true" /><span>{length}</span></span>}
            </button>
          )}
          <span id="best-lift-label" hidden>{label}</span>
        </>}
      </div>
      {state === 'ready' && (
        <div className={`best-actions${opening ? ' opening' : ''}`} onAnimationEnd={e => { if (e.target === e.currentTarget) setOpening(false); }}>
          <div className="best-actions-in">
            <button className="btn ghost small" type="button" onClick={() => void share()} aria-busy={sharing || undefined}>{sharing ? W.sharing : W.share}</button>
            <button className="btn ghost small" type="button" onClick={download}>{W.save}</button>
          </div>
        </div>
      )}
      {state === 'failed' && failed === 'retry' && (
        <div className="best-actions">
          <div className="best-actions-in">
            <button className="btn ghost small" type="button" onClick={() => void tryAgain()}>{W.tryAgain}</button>
          </div>
        </div>
      )}
    </section>
  );
}
