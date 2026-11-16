'use client';
/* eslint-disable @next/next/no-img-element -- the card PNGs are drawn at their final size by /api/card */
// "Your meet card" (plan 5.30, look 9) in her browser: the four formats in segments, and the buttons.
//   Share: Web Share with the file where the phone can, or the file downloads.
//   Save to my phone: always the download. It never shares anything (item 99).
//   Copy my card link: /card/<token>.
// On the Clip segment, "Share" or "Copy my card link" puts this clip, and only this clip, on her card
// link the first time (item 99), so the line under it changes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CARD_WORDS, type CardSegment } from '@/lib/card/card-words';
import { HONEST_LINE } from '@/lib/site';

type Props = {
  token: string;
  name: string;
  clip: { ready: boolean; shared: boolean };
  /** her videos are "Only the judges", so the Clip says who can watch it */
  judgesOnly: boolean;
};

const fileUrl = (token: string, seg: CardSegment, download = false) => {
  const q = download ? 'download=1' : '';
  if (seg === 'Clip') return `/api/card/${token}.mp4${q ? `?${q}` : ''}`;
  return `/api/card/${token}.png?f=${seg === 'Post' ? 'post' : 'story'}${q ? `&${q}` : ''}`;
};

/** The certificate at its true size (8.5 × 11 in at 96 px), scaled to the frame, so it prints as itself. */
function PrintPreview({ frame }: { frame: React.RefObject<HTMLIFrameElement | null> }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(360 / 816);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 816));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="card-print-frame" ref={box}>
      <iframe ref={frame} src="/me/card/print?embed=1" title="Your certificate" tabIndex={-1}
        style={{ width: 816, height: 1056, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
    </div>
  );
}

export function CardScreen({ token, name, clip, judgesOnly }: Props) {
  const [seg, setSeg] = useState<CardSegment>('Story');
  const [ready, setReady] = useState(clip.ready);
  const [shared, setShared] = useState(clip.shared);
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const printFrame = useRef<HTMLIFrameElement>(null);

  // the clip takes about a minute: while she's on Clip, look again every 8 s until it's there, then it plays
  useEffect(() => {
    if (ready || seg !== 'Clip') return;
    const t = setInterval(async () => {
      try {
        const r = await fetch('/api/me/card/share-clip', { cache: 'no-store' });
        const j = r.ok ? await r.json() as { ready?: boolean } : null;
        if (j?.ready) setReady(true);
      } catch { /* try again */ }
    }, 8000);
    return () => clearInterval(t);
  }, [ready, seg]);

  // Web Share needs the file in hand when she taps, so fetch this segment's file ahead of the tap
  useEffect(() => {
    setFile(null);
    if (seg === 'Print' || (seg === 'Clip' && !ready)) return;
    let gone = false;
    (async () => {
      try {
        const r = await fetch(fileUrl(token, seg));
        if (!r.ok) return;
        const b = await r.blob();
        const ext = seg === 'Clip' ? 'mp4' : 'png';
        if (!gone) setFile(new File([b], `first-meet-${seg.toLowerCase()}.${ext}`, { type: seg === 'Clip' ? 'video/mp4' : 'image/png' }));
      } catch { /* the button downloads instead */ }
    })();
    return () => { gone = true; };
  }, [seg, ready, token]);

  const shareClip = useCallback(async () => {
    if (seg !== 'Clip' || !ready || shared) return;
    setShared(true);
    try { await fetch('/api/me/card/share-clip', { method: 'POST' }); } catch { /* the next tap tries again */ }
  }, [seg, ready, shared]);

  const download = () => {
    const a = document.createElement('a');
    a.href = fileUrl(token, seg, true);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const share = async () => {
    if (file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `${name}'s meet card` });
        void shareClip();
      } catch (e) {
        // she closed the share sheet: nothing was shared
        if ((e as Error)?.name !== 'AbortError') { download(); void shareClip(); }
      }
      return;
    }
    download();
    void shareClip();
  };

  const copy = async () => {
    const url = `${location.origin}/card/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setShown(url); }
    void shareClip();
  };

  const clipLine = judgesOnly && seg === 'Clip' && ready ? (shared ? CARD_WORDS.shared : CARD_WORDS.onlyYou) : null;
  const fileButtons = seg !== 'Print';
  const noFile = seg === 'Clip' && !ready;

  return (
    <>
      <h1 className="page-title">{CARD_WORDS.title}</h1>
      <fieldset className="segments">
        <legend>Card format</legend>
        {CARD_WORDS.segments.map(s => (
          <label key={s}><input type="radio" name="card-format" value={s} checked={seg === s} onChange={() => setSeg(s)} />{s}</label>
        ))}
      </fieldset>

      {seg === 'Story' && <div className="card-frame story"><img src={fileUrl(token, 'Story')} alt={`${name}'s meet card, story size`} width={1080} height={1920} /></div>}
      {seg === 'Post' && <div className="card-frame post"><img src={fileUrl(token, 'Post')} alt={`${name}'s meet card, post size`} width={1080} height={1350} /></div>}
      {seg === 'Clip' && (
        <div className="card-frame story">
          {ready
            ? <video src={fileUrl(token, 'Clip')} controls playsInline preload="metadata" aria-label={`${name}'s lift clip`} />
            : <div className="card-making" style={{ height: '100%' }}><p className="body" aria-live="polite">{CARD_WORDS.making}</p></div>}
        </div>
      )}
      {seg === 'Print' && <PrintPreview frame={printFrame} />}

      <p className="caption honest">{HONEST_LINE}</p>
      {clipLine && <p className="body clip-line" aria-live="polite">{clipLine}</p>}

      <div className="try-actions">
        {fileButtons ? (
          <>
            <button className="btn" type="button" onClick={() => void share()} disabled={noFile}>{CARD_WORDS.share}</button>
            <button className="btn ghost" type="button" onClick={download} disabled={noFile}>{CARD_WORDS.save}</button>
          </>
        ) : (
          <>
            <button className="btn" type="button" onClick={() => printFrame.current?.contentWindow?.print()}>{CARD_WORDS.print}</button>
            <p className="small">{CARD_WORDS.pdf}</p>
          </>
        )}
        <button className="btn ghost" type="button" onClick={() => void copy()} aria-live="polite">{copied ? CARD_WORDS.copied : CARD_WORDS.copy}</button>
      </div>
      {shown && <p className="small card-link-shown">{shown}</p>}
    </>
  );
}
