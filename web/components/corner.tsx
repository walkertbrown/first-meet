'use client';
// A lifter's corner page in the browser (plan 5.4; look 4, 5.8, 5.10): her nine, live; her
// attempts newest first, each with "Cheer"; the banner when a result lands; and the four cheers
// as a sheet (a tap opens them; nothing is sent until one is picked). With no saved first name,
// the same sheet turns into "Who's cheering?". June's page (/corner/demo) refreshes on her clock.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from '@phosphor-icons/react';
import { NineRow } from '@/components/platform';
import type { CornerRow, CornerView } from '@/lib/corner-view';
import { CHEERS, CHEER_KINDS, cheerEyebrow, cleanCornerName, type CheerKind } from '@/lib/cheer-words';
import { notJudgedLine } from '@/lib/stage/meet-words';
import { LightsBanner } from '@/components/banner-layer';

export const NAME_COOKIE = 'fm_corner_name';
type Live = Exclude<CornerView, { kind: 'gone' } | { kind: 'before' } | { kind: 'closed' }>;

export function saveCornerName(name: string) {
  document.cookie = `${NAME_COOKIE}=${encodeURIComponent(name)}; path=/corner; max-age=${60 * 60 * 24 * 400}; samesite=lax`;
}

/** Before meet weekend: "Your first name (so she knows who's cheering)" with Save, in a cookie. */
export function CornerNameForm({ saved }: { saved: string | null }) {
  const [value, setValue] = useState(saved ?? '');
  const [done, setDone] = useState<string | null>(saved);
  const ok = cleanCornerName(value);
  return (
    <form className="corner-name-form" onSubmit={e => { e.preventDefault(); if (ok) { saveCornerName(ok); setDone(ok); } }}>
      <label className="field">
        <span className="field-label">Your first name (so she knows who&apos;s cheering)</span>
        <input className="input" name="name" value={value} maxLength={30} autoComplete="given-name" onChange={e => setValue(e.target.value)} />
      </label>
      <button className="btn ghost" type="submit" disabled={!ok || ok === done}>Save</button>
    </form>
  );
}

const sentKey = (token: string) => `fm-cheers-${token}`;
function readSent(token: string): Record<string, CheerKind> {
  try { return JSON.parse(localStorage.getItem(sentKey(token)) ?? '{}') as Record<string, CheerKind>; } catch { return {}; }
}
function writeSent(token: string, v: Record<string, CheerKind>) {
  try { localStorage.setItem(sentKey(token), JSON.stringify(v)); } catch { /* no storage: the button still shows it this visit */ }
}

type Banner = { id: string; text: string; call: 'white' | 'red'; lights: ('white' | 'red')[] };

export function CornerLive({ view, token, savedName, children }: { view: Live; token: string; savedName: string | null; children?: React.ReactNode }) {
  const router = useRouter();
  const [banner, setBanner] = useState<Banner | null>(null);
  const [sent, setSent] = useState<Record<string, CheerKind>>({});
  const [name, setName] = useState<string | null>(savedName);
  const [sheet, setSheet] = useState<CornerRow | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const seen = useRef<Map<string, CornerRow['state']> | null>(null);

  useEffect(() => { setSent(readSent(token)); }, [token]);

  // live: June's page on her clock; a lifter's on the stream, with a slow poll behind it
  useEffect(() => {
    if (view.june) {
      if (!view.nextAt) return;
      const t = setTimeout(() => router.refresh(), Math.max(200, view.nextAt - Date.now() + 300));
      return () => clearTimeout(t);
    }
  }, [view.june, view.nextAt, router]);
  useEffect(() => {
    if (view.june) return;
    const es = typeof EventSource !== 'undefined' ? new EventSource(`/api/corner/${token}/live`) : null;
    es?.addEventListener('attempt', () => router.refresh());
    // on (re)connect, read the page again: that's how a dropped stream catches up
    es?.addEventListener('open', () => { if (seen.current) router.refresh(); });
    const id = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, 30_000);
    return () => { es?.close(); clearInterval(id); };
  }, [view.june, token, router]);

  // the banner (look 5.10): a result that landed while the page was open
  useEffect(() => {
    const before = seen.current;
    seen.current = new Map(view.list.map(r => [r.id, r.state]));
    if (!before) return;
    const landed = view.list.find(r => (r.state === 'white' || r.state === 'red') && before.get(r.id) !== r.state);
    if (landed && (landed.state === 'white' || landed.state === 'red')) {
      setBanner({ id: landed.id, text: `${view.name} · ${landed.name} · ${landed.weight} · `, call: landed.state, lights: landed.lights });
    }
  }, [view.list, view.name]);
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(t);
  }, [banner]);

  const send = useCallback(async (row: CornerRow, kind: CheerKind, from: string | null) => {
    setSent(s => { const n = { ...s, [row.id]: kind }; writeSent(token, n); return n; });
    try {
      const r = await fetch(`/api/corner/${token}/cheer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attempt_id: row.id, kind, name: from }) });
      if (!r.ok && r.status !== 409) throw new Error(String(r.status));
    } catch {
      setSent(s => { const n = { ...s }; delete n[row.id]; writeSent(token, n); return n; });
    }
  }, [token]);

  return (
    <>
      {banner && (
        <LightsBanner lights={banner.lights} text={banner.text} call={banner.call} onDismiss={() => setBanner(null)} />
      )}
      <NineRow row={view.row} division={view.division} label="Her nine attempts" />
      {children}
      {view.kind === 'live' && view.notStarted && <p className="body-l corner-wait">{view.notStarted}</p>}
      {view.list.length > 0 && (
        <ul className="corner-list" aria-label="Her attempts, newest first">
          {view.list.map(r => (
            <li key={r.id} className="corner-row">
              {r.clip && (
                <button type="button" className="corner-clip" aria-label={`Play ${r.name}`} onClick={() => setPlaying(r.clip)}>
                  <video src={r.clip} preload="metadata" muted playsInline />
                </button>
              )}
              <div className="corner-what">
                <span className="corner-name">{`${r.name} · `}<span className={r.state === 'void' ? 'nj-weight' : undefined}>{r.weight}</span></span>
                {r.state === 'looking' && <span className="small">The judges are looking</span>}
                {r.state === 'close' && <span className="small">A referee is looking at this one.</span>}
              </div>
              {r.state === 'void' ? <span className="small nj-line">{notJudgedLine(r.voidReason)}</span>
                : r.state === 'close' ? <span className="lamps-mini" aria-hidden="true"><i className="mini-lamp pulse" /></span>
                : (
                  <span className="lamps-mini" role="img" aria-label={r.state === 'white' ? 'Good lift' : r.state === 'red' ? 'No lift' : 'Not judged yet'}>
                    {(r.state === 'looking' ? ['', '', ''] : r.lights).map((x, i) => <i key={i} className={`mini-lamp ${x}`} />)}
                  </span>
                )}
              {r.state === 'void' ? null : sent[r.id]
                ? <span className="cheer-btn sent">{`Cheered: ${CHEERS[sent[r.id]]}`}</span>
                : <button type="button" className="cheer-btn" onClick={() => setSheet(r)}>Cheer</button>}
            </li>
          ))}
        </ul>
      )}
      {sheet && (
        <CheerSheet
          lifter={view.name} row={sheet} name={name}
          onClose={() => setSheet(null)}
          onSend={(kind, from) => {
            if (from) { saveCornerName(from); setName(from); }
            void send(sheet, kind, from);
          }}
        />
      )}
      {playing && (
        <div className="corner-player" role="dialog" aria-modal="true" aria-label="Her clip">
          <video src={playing} controls autoPlay playsInline />
          <button type="button" className="corner-player-close" aria-label="Close the clip" onClick={() => setPlaying(null)}><X weight="bold" /></button>
        </div>
      )}
    </>
  );
}

/**
 * The four cheers (look 5.8, 5.10) under the sheet's Eyebrow (5.4): Ghost buttons, focus on the first. Picking one sends it, and
 * the sheet goes out in 320 ms. With no saved name, the sheet crossfades (200 ms) to "Who's
 * cheering?" and grows to its height in 260 ms.
 */
export function CheerSheet({ lifter, row, name, onClose, onSend }: {
  lifter: string; row: Pick<CornerRow, 'name'>; name: string | null;
  onClose: () => void; onSend: (kind: CheerKind, from: string | null) => void;
}) {
  const [step, setStep] = useState<{ kind: 'pick' } | { kind: 'name'; cheer: CheerKind }>({ kind: 'pick' });
  const [leaving, setLeaving] = useState(false);
  const [first, setFirst] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const lastH = useRef(0);

  const close = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(onClose, still ? 0 : 320);
  }, [leaving, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [close]);
  useEffect(() => {
    requestAnimationFrame(() => (step.kind === 'pick'
      ? ref.current?.querySelector<HTMLElement>('.cheer-choice')
      : ref.current?.querySelector<HTMLElement>('input'))?.focus());
  }, [step.kind]);
  // grow to the new step's height (260 ms); motion off: at once
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const to = el.scrollHeight;
    const from = lastH.current;
    lastH.current = to;
    if (!from || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.style.height = `${from}px`;
    void el.offsetHeight;
    el.style.transition = 'height 260ms var(--ease-out)';
    el.style.height = `${to}px`;
    const done = () => { el.style.height = ''; el.style.transition = ''; };
    el.addEventListener('transitionend', done, { once: true });
    return () => el.removeEventListener('transitionend', done);
  }, [step.kind]);

  const pick = (kind: CheerKind) => {
    if (name) { onSend(kind, name); close(); return; }
    lastH.current = inner.current?.offsetHeight ?? 0;
    setStep({ kind: 'name', cheer: kind });
  };
  const ok = cleanCornerName(first);

  return (
    <div className={leaving ? 'sheet-scrim leaving' : 'sheet-scrim'} onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="bottom-sheet cheer-sheet" role="dialog" aria-modal="true" aria-label={step.kind === 'pick' ? `Cheer for ${lifter}` : 'Who\'s cheering?'} ref={ref}>
        <span className="grab" aria-hidden="true" />
        <div className="cheer-inner" ref={inner}>
          {step.kind === 'pick' ? (
            <div className="cheer-step" key="pick">
              <span className="eyebrow cheer-eyebrow">{cheerEyebrow(lifter, row.name)}</span>
              <div className="cheer-choices">
                {CHEER_KINDS.map(k => <button key={k} type="button" className="btn ghost cheer-choice" onClick={() => pick(k)}>{CHEERS[k]}</button>)}
              </div>
            </div>
          ) : (
            <form className="cheer-step fade-in" key="name" onSubmit={e => { e.preventDefault(); if (ok) { onSend(step.cheer, ok); close(); } }}>
              <h2 className="sheet-title">Who&apos;s cheering?</h2>
              <label className="field">
                <span className="field-label">Your first name</span>
                <input className="input" value={first} maxLength={30} autoComplete="given-name" onChange={e => setFirst(e.target.value)} />
              </label>
              <div className="try-actions">
                <button className="btn" type="submit" disabled={!ok}>Send cheer</button>
                <button className="link" type="button" onClick={() => { onSend(step.cheer, null); close(); }}>Send without a name</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
