'use client';
// One close call, the referee's side (plan 5.33, look 5.13): the clip with slow motion, frame
// stepping and the judge's marks; on a Home attempt the rep strip; three lamps set by "White
// light" and "Red light"; a reason card under each red; the line naming what's missing, "Save the
// lights" and "Ask another referee".
// The demo referee (5.36) is the same screen deciding the demo lifter's own close call.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MarkFrame, Track } from '@/lib/referee-view';
import { reasonEyebrow, reasonSentence, refereeReasons, type ReasonCode } from '@/lib/reason-words';
import { saveLine, type Light } from '@/lib/lights';
import { readyToSeek } from '@/lib/stage/recorder';
type RepLight = { call: 'white' | 'red' | 'close'; reason: string | null; frame_ms?: number };

export type RefereeCallProps = {
  saveUrl: string;
  /** "Ask another referee", or null when this referee can't ask (the second referee, the demo). */
  askUrl: string | null;
  lift: string;
  division: string;
  videoUrl: string | null;
  track: Track | null;
  judgedFrameMs: number | null;
  repLights: RepLight[] | null;
  repsDeclared: number | null;
  measured: string[];
  /** The demo referee: after saving, back to the demo platform. */
  demoDoneHref?: string;
};

const FRAME_S = 1 / 30;
const LAMPS = ['Left', 'Head', 'Right'] as const;
const SPEEDS = [0.5, 0.25] as const;

/** The track's frame nearest `ms`, if one is within 120 ms. */
function frameAt(track: Track | null, ms: number): MarkFrame | null {
  if (!track) return null;
  const f = track.frames;
  let lo = 0, hi = f.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (f[mid].t < ms) lo = mid + 1; else hi = mid;
  }
  const best = [f[lo], f[lo - 1]].filter(Boolean).sort((a, b) => Math.abs(a.t - ms) - Math.abs(b.t - ms))[0];
  return best && Math.abs(best.t - ms) <= 120 ? best : null;
}

/** The lockout angle arc at the hip, from the thigh round to the torso. */
function arcPath(m: MarkFrame, r: number) {
  const [hx, hy] = m.h;
  const a1 = Math.atan2(m.k[1] - hy, m.k[0] - hx);
  const a2 = Math.atan2(m.s[1] - hy, m.s[0] - hx);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const x1 = hx + r * Math.cos(a1), y1 = hy + r * Math.sin(a1);
  const x2 = hx + r * Math.cos(a1 + d), y2 = hy + r * Math.sin(a1 + d);
  return `M ${x1} ${y1} A ${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${x2} ${y2}`;
}

function Marks({ m, track, scale }: { m: MarkFrame; track: Track; scale: number }) {
  const k = scale || 1;
  const c = 'var(--stage-ink)';
  const dir = m.k[0] >= m.h[0] ? 1 : -1;
  return (
    <svg className="ref-marks" viewBox={`0 0 ${track.w} ${track.h}`} aria-hidden="true">
      <line x1={m.k[0] - 70 * dir / k} y1={m.k[1]} x2={m.k[0] + 20 * dir / k} y2={m.k[1]} stroke={c} strokeOpacity={0.45} strokeWidth={1.5 / k} />
      <line x1={m.h[0]} y1={m.h[1]} x2={m.k[0]} y2={m.k[1]} stroke={c} strokeWidth={2.5 / k} strokeDasharray={`${6 / k} ${5 / k}`} />
      <path d={arcPath(m, 34 / k)} fill="none" stroke={c} strokeWidth={2.5 / k} />
      <line x1={m.h[0]} y1={m.h[1]} x2={m.s[0]} y2={m.s[1]} stroke={c} strokeOpacity={0.45} strokeWidth={1.5 / k} />
      <circle cx={m.h[0]} cy={m.h[1]} r={6 / k} fill={c} />
      <circle cx={m.k[0]} cy={m.k[1]} r={6 / k} fill={c} />
    </svg>
  );
}

const miniClass = (c: RepLight['call']) => `mini-lamp ${c === 'close' ? 'pulse' : c}`;

export function RefereeCall(p: RefereeCallProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [now, setNow] = useState((p.judgedFrameMs ?? 0) / 1000);
  const [duration, setDuration] = useState(0);
  const [showMarks, setShowMarks] = useState(true);
  const [scale, setScale] = useState(1);
  const [lights, setLights] = useState<(Light | null)[]>([null, null, null]);
  const [reasons, setReasons] = useState<(ReasonCode | null)[]>([null, null, null]);
  const reps = useMemo(() => (p.repsDeclared ? (p.repLights ?? []).slice(0, p.repsDeclared) : []), [p.repLights, p.repsDeclared]);
  const home = !!p.repsDeclared;
  const [rep, setRep] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { kind: 'saved' | 'asked' | 'taken'; next: string | null }>(null);
  const [error, setError] = useState<string | null>(null);

  const missing = saveLine(lights, reasons, home, rep);
  const canSave = !missing && !busy;
  const anyRed = lights.includes('red');
  const setLamp = (i: number, l: Light) => setLights(ls => ls.map((x, j) => (j === i ? l : x)));
  const setAll = (l: Light) => setLights([l, l, l]);

  const seek = useCallback((s: number) => {
    const v = videoRef.current;
    if (!v) return;
    const t = Math.max(0, Math.min(s, duration || s));
    v.currentTime = t;
    setNow(t);
  }, [duration]);

  const step = useCallback((dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    seek(v.currentTime + dir * FRAME_S);
  }, [seek]);

  const goRep = useCallback((i: number) => {
    const r = reps[i];
    if (!r) return;
    setRep(i + 1);
    videoRef.current?.pause();
    if (typeof r.frame_ms === 'number') seek(r.frame_ms / 1000);
  }, [reps, seek]);

  // The clip's time while it plays, every frame, so the marks follow.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const tick = () => { const v = videoRef.current; if (v) setNow(v.currentTime); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing]);

  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed]);

  // The clip's length. A phone's own WebM has none in its header (its duration is Infinity),
  // so it's found the way the stage finds it, by seeking to the end once (readyToSeek); then
  // the playhead goes to the judged frame. Asked once, from whichever comes first.
  const lengthAsked = useRef(false);
  const learnLength = useCallback((v: HTMLVideoElement) => {
    if (lengthAsked.current) return;
    lengthAsked.current = true;
    readyToSeek(v).then(() => {
      if (!Number.isFinite(v.duration) || v.duration <= 0) return;
      setDuration(v.duration);
      v.currentTime = (p.judgedFrameMs ?? 0) / 1000;
    }).catch(() => { lengthAsked.current = false; });
  }, [p.judgedFrameMs]);
  // A cached clip can load before the page is ready, so its loadedmetadata is never heard.
  useEffect(() => {
    const v = videoRef.current;
    if (v && v.readyState >= 1) learnLength(v);
  }, [learnLength]);

  // After a save, focus goes to where she goes next ("Back to the platform", or "Next").
  const doneRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => { if (done) doneRef.current?.focus(); }, [done]);

  // The marks keep their size in screen pixels whatever size the clip is drawn at.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !p.track) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / p.track!.w));
    ro.observe(el);
    return () => ro.disconnect();
  }, [p.track]);

  // Keys: ← and → step a frame; [ and ] move between reps; space plays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range'))) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (home && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        const cur = rep ?? nearestRep();
        goRep(Math.max(0, Math.min(reps.length - 1, cur - 1 + (e.key === ']' ? 1 : -1))));
      }
    };
    const nearestRep = () => {
      const ms = now * 1000;
      let best = 0;
      reps.forEach((r, i) => { if (Math.abs((r.frame_ms ?? 0) - ms) < Math.abs((reps[best].frame_ms ?? 0) - ms)) best = i; });
      return reps.length ? best + 1 : 1;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, goRep, home, rep, reps, now]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { if (v.ended) v.currentTime = 0; void v.play(); } else v.pause();
  };

  async function send(body: Record<string, unknown>, url: string, kind: 'saved' | 'asked') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({})) as { next?: string | null; error?: string };
      if (res.ok) { setDone({ kind, next: out.next ?? null }); return; }
      if (res.status === 409) { setDone({ kind: 'taken', next: null }); return; }
      setError("That didn't save. Check the lights and try again.");
    } catch {
      setError("That didn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const save = () => canSave && send({
    action: 'save', lights, reasons: lights.map((l, i) => (l === 'red' ? reasons[i] : null)), rep: anyRed && home ? rep : null,
  }, p.saveUrl, 'saved');
  const ask = () => {
    if (!p.askUrl) return;
    if (!asking) { setAsking(true); return; }
    void send({ action: 'ask', note: note.trim() || null }, p.askUrl, 'asked');
  };

  const mark = showMarks ? frameAt(p.track, now * 1000) : null;
  const ar = p.track ? p.track.w / p.track.h : 16 / 9;

  if (done) {
    const nextHref = p.demoDoneHref ?? (done.next ? `/referee/${done.next}` : '/referee');
    const line = p.demoDoneHref
      ? 'Saved. Your lights are on the platform.'
      : done.kind === 'saved' ? 'Saved. Next close call?'
        : done.kind === 'asked' ? 'Sent to another referee. Next close call?'
          : 'Another referee has already decided this one. Next close call?';
    return (
      <div className="ref-done" role="status">
        <p className="sheet-title">{line}</p>
        <Link ref={doneRef} className="btn" href={nextHref}>{p.demoDoneHref ? 'Back to the platform' : 'Next'}</Link>
      </div>
    );
  }

  return (
    <div className="ref-call">
      <div className="ref-clip" style={{ ['--ar' as string]: ar }}>
        <div className="ref-video" ref={boxRef}>
          {p.videoUrl ? (
            <video
              ref={videoRef}
              src={p.videoUrl}
              playsInline
              muted
              preload="auto"
              onLoadedMetadata={e => learnLength(e.currentTarget)}
              onPlay={() => setPlaying(true)}
              onPause={() => { setPlaying(false); setNow(videoRef.current?.currentTime ?? now); }}
              onSeeked={e => setNow(e.currentTarget.currentTime)}
              onClick={togglePlay}
            />
          ) : (
            <p className="ref-noclip small">The clip isn&apos;t available.</p>
          )}
          {mark && p.track && <Marks m={mark} track={p.track} scale={scale} />}
        </div>

        <div className="ref-scrub" style={{ ['--played' as string]: `${duration > 0 ? Math.min(100, (now / duration) * 100) : 0}%` }}>
          <input
            type="range" min={0} max={duration || 1} step={0.001} value={Math.min(now, duration || 1)}
            aria-label="Position in the clip" aria-valuetext={`${now.toFixed(2)} seconds`}
            onChange={e => { videoRef.current?.pause(); seek(Number(e.target.value)); }}
          />
          {duration > 0 && reps.map((r, i) => typeof r.frame_ms === 'number' && (
            <span key={i} className="ref-tick" style={{ ['--at' as string]: Math.min(1, r.frame_ms / 1000 / duration) }} aria-hidden="true" />
          ))}
        </div>

        <div className="ref-controls">
          <button type="button" className="btn ghost small" onClick={togglePlay} disabled={!p.videoUrl}>{playing ? 'Pause' : 'Play'}</button>
          {SPEEDS.map(s => (
            <button key={s} type="button" className="btn ghost small" aria-pressed={speed === s} onClick={() => setSpeed(v => (v === s ? 1 : s))}>
              {s === 0.5 ? '0.5×' : '0.25×'}
            </button>
          ))}
          <button type="button" className="btn ghost small" onClick={() => step(-1)} disabled={!p.videoUrl}>← frame</button>
          <button type="button" className="btn ghost small" onClick={() => step(1)} disabled={!p.videoUrl}>frame →</button>
          <label className="ref-switch">
            <input type="checkbox" checked={showMarks} onChange={e => setShowMarks(e.target.checked)} disabled={!p.track} />
            <span aria-hidden="true" />
            Show the judge&apos;s marks
          </label>
        </div>

        {home && reps.length > 0 && (
          <div className="ref-reps">
            <p className="small">Judge every rep. One red rep makes the attempt red.</p>
            <div className="ref-repstrip" role="group" aria-label="Reps">
              {reps.map((r, i) => (
                <button
                  key={i} type="button" className="ref-rep" aria-pressed={rep === i + 1} onClick={() => goRep(i)}
                  aria-label={`Rep ${i + 1}: the judge called it ${r.call === 'close' ? 'too close to call' : r.call}`}
                >
                  <span className="num">{i + 1}</span>
                  <i className={miniClass(r.call)} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <aside className="ref-side">
        {p.measured.length > 0 && (
          <section className="ref-measured" aria-label="What the judge measured">
            <h2 className="eyebrow">What the judge measured</h2>
            {p.measured.map(l => <p key={l} className="small">{l}</p>)}
          </section>
        )}

        <section className="ref-lamps" aria-label="Your lights">
          {LAMPS.map((name, i) => (
            <div key={name} className="ref-lamp" role="group" aria-label={name}>
              <div className="ref-lamp-row">
                <div className="ref-lamp-name">
                  <span className="eyebrow">{name}</span>
                  <i key={lights[i] ?? 'off'} className={`mini-lamp lg${lights[i] ? ' ' + lights[i] : ''}`} aria-hidden="true" />
                </div>
                <div className="ref-lamp-buttons">
                  <button type="button" className="ref-light white" aria-pressed={lights[i] === 'white'} onClick={() => setLamp(i, 'white')}>White light</button>
                  <button type="button" className="ref-light red" aria-pressed={lights[i] === 'red'} onClick={() => setLamp(i, 'red')}>Red light</button>
                </div>
              </div>
              {lights[i] === 'red' && (
                <fieldset className="ref-reasons">
                  <legend className="sr">{`The reason for the ${name.toLowerCase()} red light`}</legend>
                  {refereeReasons(p.lift, p.division).map(code => (
                    <label key={code} className="choice">
                      <input type="radio" name={`reason-${i}`} value={code} checked={reasons[i] === code}
                        onChange={() => setReasons(rs => rs.map((x, j) => (j === i ? code : x)))} />
                      <span className="choice-label eyebrow">{reasonEyebrow(code, home ? rep : null)}</span>
                      <span className="small">{reasonSentence(code, p.lift, p.division)}</span>
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
          ))}
        </section>
        <div className="ref-all">
          <button type="button" className="btn ghost small" onClick={() => setAll('white')}>All white</button>
          <button type="button" className="btn ghost small" onClick={() => setAll('red')}>All red</button>
        </div>

        {error && <p className="small" role="alert">{error}</p>}

        <div className="ref-actions">
          <div className="ref-save">
            {missing && <p className="small ref-missing" id="ref-missing">{missing}</p>}
            <button type="button" className="btn" disabled={!canSave} aria-busy={busy} aria-describedby={missing ? 'ref-missing' : undefined} onClick={save}>Save the lights</button>
          </div>
          {p.askUrl && (
            <>
              {asking && (
                <label className="ref-note">
                  <span className="small">A note for the other referee (optional)</span>
                  <textarea rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} />
                </label>
              )}
              <button type="button" className="btn ghost" disabled={busy} onClick={ask}>Ask another referee</button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
