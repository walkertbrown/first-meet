'use client';
// The platform during the window (plan 5.24–5.27, look 4, 5.9, 5.10): the eyebrow, the 9-attempt
// row, the attempt she lifts now, the declare sheet, and the banner when a referee's lights land.
// What she declares is checked on the server against the same choices (web/lib/meet-flow.ts).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight } from '@phosphor-icons/react';
import { MeetAttempt } from '@/components/meet-attempt';
import { BarDiagram } from '@/components/bar-diagram';
import { PLAN_SWITCHES } from '@/lib/plan-switches';
import type { CardAttempt, RowCell } from '@/lib/platform-view';
import type { DeclareSheet } from '@/lib/meet-flow';
import {
  DECLARE_WORDS, WELCOME_WORDS, capLine, choiceWords, declareButton, liftWord, loadingLine, meetResult,
} from '@/lib/stage/meet-words';

type Lifter = { cardName: string; ageGroup: string | null; division: 'barbell' | 'home'; units: 'lb' | 'kg' };
type Sheet = Extract<DeclareSheet, { kind: 'sheet' }>;
type Declared = { lift: string; number: number; weight: number; reps_declared: number | null };

const GROUPS: Record<'barbell' | 'home', string[]> = { barbell: ['Squat', 'Bench', 'Deadlift'], home: ['Goblet squat', 'Overhead press', 'Deadlift'] };

/**
 * The 9-attempt row (look 4): three groups of three 34 px slots; a judged slot shows its mini lamp.
 * A close call (5.27): the 1:12 AM copy puts "Waiting" in the slot; item 76 keeps the slot 34 px with
 * only its pulsing unlit lamp and puts "WAITING" under the group, once (look 4, "Waiting on a referee").
 */
export function NineRow({ row, division, label = 'Your nine attempts', item76 = PLAN_SWITCHES.item76 }: { row: RowCell[]; division: 'barbell' | 'home'; label?: string; item76?: boolean }) {
  return (
    <div className={item76 ? 'nine wait-below' : 'nine'} aria-label={label}>
      {[0, 1, 2].map(g => {
        const cells = row.slice(g * 3, g * 3 + 3);
        return (
          <div className="grp" key={g}>
            <span className="eyebrow">{GROUPS[division][g]}</span>
            <div className="slots">
              {cells.map(c => {
                const name = `${liftWord(c.lift, division)} ${c.number}`;
                const said = c.state === 'white' ? 'good lift' : c.state === 'red' ? 'no lift'
                  : c.state === 'waiting' ? (item76 ? 'waiting for a referee' : 'Waiting') : c.state === 'now' ? 'now' : '';
                return (
                  <div key={c.number} className={`slot ${c.state}`} aria-label={said ? `${name}, ${said}` : name} role="img">
                    {c.state === 'white' || c.state === 'red' ? <i className={`mini-lamp ${c.state}`} />
                      : c.state === 'waiting' ? <><i className="mini-lamp pulse" />{!item76 && <span className="slot-wait">Waiting</span>}</>
                        : <span aria-hidden="true">{c.number}</span>}
                  </div>
                );
              })}
            </div>
            {item76 && <span className={cells.some(c => c.state === 'waiting') ? 'grp-wait eyebrow on' : 'grp-wait eyebrow'} aria-hidden="true">Waiting</span>}
          </div>
        );
      })}
    </div>
  );
}

/** 5.27's banner: a referee's lights on an earlier attempt landed while she was here. */
type Banner = { id: string; text: string; call: 'white' | 'red'; lights: ('white' | 'red')[]; stays: boolean };

export function Platform({ meetName, closesAt, row, current, because, notJudged, lifter, voicePack, demo, welcomeCorner = null }: {
  meetName: string; closesAt: string | null; row: RowCell[]; current: CardAttempt; because: string; notJudged: boolean;
  lifter: Lifter; voicePack: string; demo: boolean;
  /** The demo's welcome sheet (5.36), with her corner page's link; null when it's not shown. */
  welcomeCorner?: string | null;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [declared, setDeclared] = useState<Declared | null>(null);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState<Banner | null>(null);
  const [welcome, setWelcome] = useState(!!welcomeCorner);
  // closing it drops ?welcome=1, so a reload doesn't bring it back
  const closeWelcome = useCallback(() => { setWelcome(false); router.replace('/platform', { scroll: false }); }, [router]);
  const rowRef = useRef(row);
  rowRef.current = row;

  // "Declare your next attempt" / "Next: <lift>" / "See your total" (5.25 step 11)
  const onNext = useCallback(async () => {
    setError('');
    const r = await fetch('/api/meet/declare', { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
    const s = r?.ok ? await r.json() as DeclareSheet : null;
    if (!s) { setError("We couldn't reach First Meet. Try again in a moment."); return; }
    if (s.kind === 'none') { if (s.why === 'done') router.push('/platform/total'); else router.refresh(); return; }
    if (s.kind === 'opener') {
      // an opener is on her card without a sheet ("Next: Bench press")
      const p = await fetch('/api/meet/declare', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null);
      if (!p?.ok) { setError("We couldn't reach First Meet. Try again in a moment."); return; }
      router.refresh();
      return;
    }
    setSheet(s);
    setPicked((s.choices.find(c => c.selected && !c.disabled) ?? s.choices.find(c => !c.disabled))?.value ?? null);
  }, [router]);

  const declare = async () => {
    if (!sheet || picked === null || declaring) return;
    setDeclaring(true); setError('');
    const r = await fetch('/api/meet/declare', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: picked }),
    }).catch(() => null);
    setDeclaring(false);
    const body = r ? await r.json().catch(() => null) as { attempt?: Declared } | null : null;
    if (!r?.ok || !body?.attempt) { setError("That didn't go through. Try again in a moment."); return; }
    setDeclared(body.attempt);
  };

  const close = () => {
    const wasDeclared = !!declared;
    setSheet(null); setDeclared(null); setPicked(null); setError('');
    if (wasDeclared) router.refresh();
  };

  // 5.27: a close call's lights from a referee land while she's on the platform
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/live');
    es.addEventListener('attempt', async ev => {
      const { attempt_id: id, status } = JSON.parse((ev as MessageEvent).data) as { attempt_id: string; status: string };
      if (id === current.id || status !== 'judged') return;
      const r = await fetch(`/api/attempts/${id}`, { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
      const a = r?.ok ? await r.json() as { lift: string; number: number; weight: number; reps_declared: number | null; call: 'white' | 'red' | 'close' | null; lights: ('white' | 'red')[] | null; reason: string | null; red_rep: number | null } : null;
      if (!a || (a.call !== 'white' && a.call !== 'red')) return;
      const wasWaiting = rowRef.current.some(c => c.lift === a.lift && c.number === a.number && c.state === 'waiting');
      if (!wasWaiting) { router.refresh(); return; }
      const res = meetResult(a)!;
      const what = lifter.division === 'home' ? `${a.reps_declared} reps` : `${a.weight} ${lifter.units}`;
      // a red after she declared a heavier next attempt: it stands (5.27)
      const stays = a.call === 'red' && rowRef.current.some(c => c.lift === a.lift && c.number === a.number + 1 && c.state !== 'empty');
      setBanner({ id, text: `${liftWord(a.lift, lifter.division)} ${a.number} · ${what} · `, call: a.call, lights: res.lamps.filter((l): l is 'white' | 'red' => l === 'white' || l === 'red'), stays });
      router.refresh();
    });
    return () => es.close();
  }, [current.id, lifter.division, lifter.units, router]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(t);
  }, [banner]);

  const closesLine = closesAt ? untilLine(closesAt) : null;
  const top = (
    <header className="platform-top">
      <p className="eyebrow">{`${meetName} · The platform is open`}</p>
      {closesLine && <p className="small">{closesLine}</p>}
      <NineRow row={row} division={lifter.division} />
    </header>
  );

  return (
    <>
      <MeetAttempt
        key={current.id}
        attempt={current}
        lifter={lifter}
        because={because}
        notJudged={notJudged}
        voicePack={voicePack}
        onNext={() => void onNext()}
        top={top}
        demoReferee={demo}
      />
      {error && !sheet && <p className="platform-error small" role="alert">{error}</p>}
      {banner && (
        <button type="button" className="banner" onClick={() => { setBanner(null); router.push(`/platform/attempt/${banner.id}`); }}>
          <span className="banner-lamps" aria-hidden="true">{banner.lights.map((l, i) => <i key={i} className={`mini-lamp ${l}`} />)}</span>
          <span className="body">
            {banner.text}<strong>{banner.call === 'white' ? 'Good lift' : 'No lift'}</strong>
            {banner.stays && <span className="banner-more"> Your next attempt stays as declared.</span>}
          </span>
        </button>
      )}
      {welcome && welcomeCorner && <WelcomeSheet corner={welcomeCorner} onClose={closeWelcome} />}
      {sheet && (
        <DeclareSheetView
          sheet={sheet} picked={picked} onPick={setPicked} declaring={declaring} declared={declared}
          error={error} onDeclare={() => void declare()} onClose={close}
        />
      )}
    </>
  );
}

/** "Until Saturday 6 pm Eastern (<local>)" (5.24). */
function untilLine(iso: string) {
  const d = new Date(iso);
  const et = d.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).replace(':00', '').replace(' AM', ' am').replace(' PM', ' pm');
  const local = d.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' AM', ' am').replace(' PM', ' pm');
  return `Until ${et} Eastern${local !== et ? ` (${local})` : ''}`;
}

/** The demo's welcome sheet (5.36, look 5.10): her corner page opens in a new tab; "Go to the platform" closes it. */
export function WelcomeSheet({ corner, onClose, item78 = PLAN_SWITCHES.item78 }: { corner: string; onClose: () => void; item78?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('button.btn')?.focus());
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="welcome-title" ref={ref}>
        <span className="grab" aria-hidden="true" />
        <h2 className="sheet-title" id="welcome-title">{WELCOME_WORDS.title}</h2>
        <p className="body">{WELCOME_WORDS.body}</p>
        <p className="body">{WELCOME_WORDS.corner}</p>
        <div className="try-actions">
          <button className="btn" type="button" onClick={onClose}>{WELCOME_WORDS.go}</button>
          {item78
            // item 78: the short label, and the new-tab mark 8 px after it (look 5.14a)
            ? <a className="btn ghost new-tab" href={corner} target="_blank" rel="noopener" aria-label={WELCOME_WORDS.openCornerSaid}>{WELCOME_WORDS.openCornerShort}<ArrowUpRight weight="bold" size={24} aria-hidden="true" /></a>
            : <a className="btn ghost" href={corner} target="_blank" rel="noopener">{WELCOME_WORDS.openCorner}</a>}
        </div>
      </div>
    </div>
  );
}

/** 5.26 as a bottom sheet (look 5.9, 5.10). */
function DeclareSheetView({ sheet, picked, onPick, declaring, declared, error, onDeclare, onClose }: {
  sheet: Sheet; picked: number | null; onPick: (v: number) => void; declaring: boolean; declared: Declared | null;
  error: string; onDeclare: () => void; onClose: () => void;
}) {
  const home = sheet.division === 'home';
  const { lift, number } = sheet.slot;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    // focus goes to the selected choice (look 5.10)
    requestAnimationFrame(() => (ref.current?.querySelector<HTMLInputElement>('input:checked') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus());
    return () => removeEventListener('keydown', onKey);
  }, [onClose, declared]);

  const loading = declared ? loadingLine(sheet.division, declared.weight, sheet.units, declared.lift, sheet.cap.kind ?? undefined) : '';
  return (
    <div className="sheet-scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="declare-title" ref={ref}>
        <span className="grab" aria-hidden="true" />
        {declared ? (
          <>
            <h2 className="sheet-title" id="declare-title">{DECLARE_WORDS.declaredTitle(declared.lift, declared.number, sheet.division)}</h2>
            <p className="body">{DECLARE_WORDS.declaredBody(sheet.division, loading)}</p>
            <div className="try-actions"><button className="btn" type="button" onClick={onClose}>{DECLARE_WORDS.ok}</button></div>
          </>
        ) : (
          <>
            <h2 className="sheet-title" id="declare-title">{DECLARE_WORDS.title(lift, number, sheet.division)}</h2>
            <p className="body">{sheet.last.red ? DECLARE_WORDS.bodyRed : DECLARE_WORDS.bodyWhite}</p>
            <fieldset className="choices">
              <legend className="sr">{DECLARE_WORDS.title(lift, number, sheet.division)}</legend>
              {sheet.choices.map(c => {
                const w = choiceWords(c, { division: sheet.division, lift, units: sheet.units, last: sheet.last.value, cap: sheet.cap.cap, reason: sheet.last.reason });
                return (
                  <label key={c.key} className={`choice${c.disabled ? ' off' : ''}`}>
                    <input type="radio" name="declare" value={c.value} checked={picked === c.value} disabled={c.disabled} onChange={() => onPick(c.value)} />
                    <span className="choice-text">
                      <span className="choice-label">{w.label}</span>
                      <span className="small">{w.line}</span>
                      {!home && <BarDiagram weight={c.value} units={sheet.units} height={26} label={loadingLine('barbell', c.value, sheet.units)} />}
                    </span>
                    <span className="weight-m num">{c.value}<span className="unit">{home ? 'reps' : sheet.units}</span></span>
                  </label>
                );
              })}
            </fieldset>
            <p className="small">{capLine({ division: sheet.division, lift, number, cap: sheet.cap.cap, judged: sheet.cap.judged, weight: sheet.cap.weight, units: sheet.units })}</p>
            {error && <p className="small" role="alert">{error}</p>}
            <div className="try-actions">
              <button className="btn" type="button" onClick={onDeclare} disabled={picked === null} aria-busy={declaring}>
                {declaring ? DECLARE_WORDS.declaring : picked === null ? declareButton(sheet.division, sheet.last.value, sheet.units) : declareButton(sheet.division, picked, sheet.units)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
