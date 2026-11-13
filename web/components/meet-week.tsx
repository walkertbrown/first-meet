'use client';
// Meet week (plan 5.23, look 5.9): her openers, the flight-time picker, her corner link, the
// set-up checklist and "Test your spot". The rules and words for each are in web/lib/meet-week.
import Link from 'next/link';
import { CaretRight } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { BarDiagram } from '@/components/bar-diagram';
import type { Lift } from '@/db/schema';
import type { OpenerView } from '@/lib/meet-week';
import { barbellChecklistLine, homeChecklistLine, pickedLine, slotLabel, tickedLine } from '@/lib/meet-week-words';
import { homeWeightsLine, liftWord, loadingLine } from '@/lib/stage/meet-words';

export type MeetWeekProps = {
  meetId: string;
  units: 'lb' | 'kg';
  division: 'barbell' | 'home';
  bar: number;
  openers: OpenerView[];
  flight: null | { counts: number[]; mine: number[]; open: boolean; hour: number | null; starts: string[] };
  cornerToken: string;
};

const ET = 'America/New_York';
const AGAIN = 'That didn\'t go through. Try again in a moment.';

/** "Other hours (7)": the hours folded in under the flight's hour (5.23). */
export const otherHoursLine = (n: number) => `Other hours (${n})`;

export const MEET_WEEK_WORDS = {
  title: 'Choose your openers',
  body: 'Your first attempt at each lift. Pick the suggested weight or a lighter one. Your second and third attempts can climb to your cap.',
  save: 'Save my openers',
  saved: 'Openers saved. You can change them until you lift.',
  weightFor: 'Your weight for this lift',
  scoresMost: 'SCORES MOST',
  flightTitle: 'Pick your flight time (optional)',
  flightBody: 'Tick every hour that works. The hour most of your flight picks is set on Tuesday. During it, you\'ll see each other\'s lights as you lift. Lifting at any other time counts the same.',
  flightHour: 'YOUR FLIGHT\'S HOUR',
  otherHours: 'Other hours',
  noHour: 'No flight time this weekend. You\'re lifting on your own schedule, and it counts the same.',
  cornerTitle: 'Your corner',
  cornerBody: 'Send your corner link to someone who\'d cheer.',
  copy: 'Copy my corner link',
  copied: 'Copied',
  checklistTitle: 'Set-up checklist',
  spotTitle: 'Test your spot',
  spot: 'Test your spot',
  again: AGAIN,
};

export const capLineBarbell = (cap: number, units: string) => `Your cap: ${cap} ${units}, your best judged triple.`;
export const capLineHome = (reps: number, weight: number, units: string) => `Your cap: ${reps} reps at ${weight} ${units}.`;

type Pick = { weight: number | null; reps: number | null };
const pickOf = (o: OpenerView): Pick => (o.division === 'barbell' ? { weight: o.picked, reps: null } : { weight: o.pickedWeight, reps: o.pickedReps });

export function MeetWeek(p: MeetWeekProps) {
  const [openers, setOpeners] = useState(p.openers);
  const [picks, setPicks] = useState<Record<string, Pick>>(() => Object.fromEntries(p.openers.map(o => [o.lift, pickOf(o)])));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const allSaved = openers.every(o => o.saved) && !dirty;

  const pick = (lift: Lift, x: Partial<Pick>) => { setPicks(cur => ({ ...cur, [lift]: { ...cur[lift], ...x } })); setDirty(true); setSaveError(''); };

  const save = async () => {
    setSaving(true); setSaveError('');
    try {
      const body = { picks: openers.filter(o => !o.locked).map(o => ({ lift: o.lift, weight: picks[o.lift].weight, reps: picks[o.lift].reps })) };
      const r = await fetch('/api/meet-week/openers', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json() as { openers: OpenerView[] };
      setOpeners(j.openers); setPicks(Object.fromEntries(j.openers.map(o => [o.lift, pickOf(o)]))); setDirty(false);
    } catch { setSaveError(AGAIN); } finally { setSaving(false); }
  };

  const checkLine = useMemo(() => {
    if (p.division === 'barbell') return barbellChecklistLine(openers.map(o => ({ lift: o.lift, weight: picks[o.lift].weight ?? 0 })), p.units, p.bar);
    return homeChecklistLine(openers.flatMap(o => {
      if (o.division !== 'home') return [];
      const w = o.weights.find(x => x.weight === picks[o.lift].weight);
      return w ? [{ lift: o.lift, weight: w.weight, kind: w.kind }] : [];
    }), p.units);
  }, [openers, picks, p.division, p.units, p.bar]);

  return (
    <>
      <section className="mw-block" aria-labelledby="mw-openers">
        <h1 className="page-title" id="mw-openers">{MEET_WEEK_WORDS.title}</h1>
        <p className="body">{MEET_WEEK_WORDS.body}</p>
        {openers.map(o => (
          <div key={o.lift} className="mw-lift">
            <h2 className="mw-lift-name">{liftWord(o.lift, p.division)}</h2>
            {o.division === 'barbell'
              ? <BarbellOpener o={o} units={p.units} picked={picks[o.lift].weight} onPick={w => pick(o.lift, { weight: w })} />
              : <HomeOpener o={o} units={p.units} picked={picks[o.lift]} onPick={x => pick(o.lift, x)} />}
          </div>
        ))}
        {saveError && <p className="small" role="alert">{saveError}</p>}
        {allSaved
          ? <p className="body mw-saved" role="status">{MEET_WEEK_WORDS.saved}</p>
          : <div className="try-actions"><button className="btn" type="button" onClick={() => void save()} disabled={saving || openers.every(o => o.locked)} aria-busy={saving}>{MEET_WEEK_WORDS.save}</button></div>}
      </section>

      {p.flight && <FlightPicker {...p.flight} />}

      <section className="mw-block" aria-labelledby="mw-corner">
        <h2 className="sheet-title" id="mw-corner">{MEET_WEEK_WORDS.cornerTitle}</h2>
        <p className="body">{MEET_WEEK_WORDS.cornerBody}</p>
        <CopyCorner token={p.cornerToken} />
      </section>

      <Checklist meetId={p.meetId} openersLine={checkLine} />

      <section className="mw-block" aria-labelledby="mw-spot">
        <h2 className="sheet-title" id="mw-spot">{MEET_WEEK_WORDS.spotTitle}</h2>
        <div className="try-actions"><Link className="btn ghost" href="/meet-week/spot">{MEET_WEEK_WORDS.spot}</Link></div>
      </section>
    </>
  );
}

function BarbellOpener({ o, units, picked, onPick }: { o: Extract<OpenerView, { division: 'barbell' }>; units: 'lb' | 'kg'; picked: number | null; onPick: (w: number) => void }) {
  return (
    <>
      <fieldset className="choices" disabled={o.locked}>
        <legend className="sr">{`${liftWord(o.lift, 'barbell')} opener`}</legend>
        {o.choices.map((w, i) => (
          <label key={w} className={`choice${o.locked ? ' off' : ''}`}>
            <input type="radio" name={`opener-${o.lift}`} value={w} checked={picked === w} onChange={() => onPick(w)} />
            <span className="choice-text">
              <span className="choice-label">{i === 0 ? `Suggested · ${w} ${units}` : `${w} ${units}`}</span>
              <span className="small">{loadingLine('barbell', w, units)}</span>
              <BarDiagram weight={w} units={units} height={26} label={loadingLine('barbell', w, units)} />
            </span>
          </label>
        ))}
      </fieldset>
      <p className="small">{capLineBarbell(o.cap, units)}</p>
    </>
  );
}

function HomeOpener({ o, units, picked, onPick }: { o: Extract<OpenerView, { division: 'home' }>; units: 'lb' | 'kg'; picked: Pick; onPick: (x: Partial<Pick>) => void }) {
  const w = o.weights.find(x => x.weight === picked.weight) ?? null;
  return (
    <>
      <p className="body mw-weight-for">{MEET_WEEK_WORDS.weightFor}</p>
      <fieldset className="choices" disabled={o.locked}>
        <legend className="sr">{`${liftWord(o.lift, 'home')}: ${MEET_WEEK_WORDS.weightFor.toLowerCase()}`}</legend>
        {o.weights.map(c => (
          <label key={c.weight} className={`choice${o.locked ? ' off' : ''}`}>
            <input type="radio" name={`weight-${o.lift}`} value={c.weight} checked={picked.weight === c.weight}
              onChange={() => onPick({ weight: c.weight, reps: c.openers[0] ?? null })} />
            <span className="choice-text">
              {c.weight === o.best && <span className="eyebrow mw-scores">{MEET_WEEK_WORDS.scoresMost}</span>}
              <span className="choice-label">{homeWeightsLine(c.weight, units, o.lift, c.kind)}</span>
              <span className="small">{c.judged ? `Best judged: ${c.capReps} reps` : 'Not judged yet'}</span>
            </span>
            <span className="weight-m num">{c.score}<span className="unit">{`${units} lifted`}</span></span>
          </label>
        ))}
      </fieldset>
      {w && (
        <>
          <fieldset className="choices mw-reps" disabled={o.locked}>
            <legend className="sr">{`${liftWord(o.lift, 'home')} opener`}</legend>
            {w.openers.map((n, i) => (
              <label key={n} className={`choice${o.locked ? ' off' : ''}`}>
                <input type="radio" name={`reps-${o.lift}`} value={n} checked={picked.reps === n} onChange={() => onPick({ reps: n })} />
                <span className="choice-text"><span className="choice-label">{i === 0 ? `Suggested · ${n} reps` : `${n} reps`}</span></span>
              </label>
            ))}
          </fieldset>
          <p className="small">{capLineHome(w.capReps, w.weight, units)}</p>
        </>
      )}
    </>
  );
}

/** Her phone's time zone, read after the first paint (the server's labels are Eastern). */
function useTimeZone() {
  const [tz, setTz] = useState(ET);
  useEffect(() => {
    try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || ET); } catch { /* Eastern */ }
  }, []);
  return tz;
}

export function FlightPicker(f: NonNullable<MeetWeekProps['flight']>) {
  const tz = useTimeZone();
  const [counts, setCounts] = useState(f.counts);
  const [mine, setMine] = useState(f.mine);
  const [error, setError] = useState('');
  const label = (i: number) => slotLabel(new Date(f.starts[i]), tz);

  const toggle = async (i: number) => {
    const before = { counts, mine };
    const next = mine.includes(i) ? mine.filter(x => x !== i) : [...mine, i].sort((a, b) => a - b);
    setMine(next);
    setCounts(counts.map((n, k) => (k === i ? n + (next.includes(i) ? 1 : -1) : n)));
    setError('');
    try {
      const r = await fetch('/api/meet-week/votes', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slots: next }) });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json() as { counts: number[]; mine: number[] };
      setCounts(j.counts); setMine(j.mine);
    } catch { setCounts(before.counts); setMine(before.mine); setError(AGAIN); }
  };

  return (
    <section className="mw-block" aria-labelledby="mw-flight">
      <h2 className="sheet-title" id="mw-flight">{MEET_WEEK_WORDS.flightTitle}</h2>
      <p className="body">{MEET_WEEK_WORDS.flightBody}</p>
      {f.open ? (
        <fieldset className="choices">
          <legend className="sr">{MEET_WEEK_WORDS.flightTitle}</legend>
          {f.starts.map((_, i) => (
            <label key={i} className="choice">
              <input type="checkbox" name="flight-hour" value={i} checked={mine.includes(i)} onChange={() => void toggle(i)} />
              <span className="choice-text">
                <span className="choice-label">{label(i)}</span>
                {counts[i] > 0 && <span className="small">{tickedLine(counts[i])}</span>}
              </span>
            </label>
          ))}
        </fieldset>
      ) : f.hour === null ? (
        <p className="body">{MEET_WEEK_WORDS.noHour}</p>
      ) : (
        <>
          <div className="choice mw-hour">
            <span className="choice-text">
              <span className="eyebrow">{MEET_WEEK_WORDS.flightHour}</span>
              <span className="choice-label">{label(f.hour)}</span>
              <span className="small">{pickedLine(counts[f.hour])}</span>
            </span>
          </div>
          <details className="mw-other">
            {/* look 5.9: a row that opens; the browser's details/summary say "collapsed" */}
            <summary>
              <CaretRight className="mw-caret" size={24} weight="bold" aria-hidden="true" />
              <span className="body mw-other-words">{otherHoursLine(f.starts.length - 1)}</span>
            </summary>
            <ul className="mw-other-list">
              {f.starts.map((_, i) => (i === f.hour ? null : (
                <li key={i}><span className="body">{label(i)}</span><span className="small">{pickedLine(counts[i])}</span></li>
              )))}
            </ul>
          </details>
        </>
      )}
      {error && <p className="small" role="alert">{error}</p>}
    </section>
  );
}

function CopyCorner({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const copy = async () => {
    const url = `${location.origin}/corner/${token}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setShown(url); }
  };
  return (
    <>
      <div className="try-actions"><button className="btn ghost" type="button" onClick={() => void copy()} aria-live="polite">{copied ? MEET_WEEK_WORDS.copied : MEET_WEEK_WORDS.copy}</button></div>
      {shown && <p className="small mw-link">{shown}</p>}
    </>
  );
}

export const CHECKLIST = [
  'A spot with space to lift, and a floor the phone can sit on',
  'Something to prop the phone: a mug, a shoe, a stand',
  '<openers>',
  'Water, and something to eat an hour before',
  'Charge your phone',
] as const;

/** The ticks are kept on her phone only (5.23). */
function Checklist({ meetId, openersLine }: { meetId: string; openersLine: string }) {
  const key = `fm-meet-week-checklist-${meetId}`;
  const [ticks, setTicks] = useState<number[]>([]);
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); if (Array.isArray(v)) setTicks(v.filter(Number.isInteger)); } catch { /* none kept */ }
  }, [key]);
  const toggle = (i: number) => {
    const next = ticks.includes(i) ? ticks.filter(x => x !== i) : [...ticks, i];
    setTicks(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* kept for this visit only */ }
  };
  return (
    <section className="mw-block" aria-labelledby="mw-check">
      <h2 className="sheet-title" id="mw-check">{MEET_WEEK_WORDS.checklistTitle}</h2>
      <ul className="mw-checklist">
        {CHECKLIST.map((t, i) => (
          <li key={i}>
            <label className="mw-check">
              <input type="checkbox" checked={ticks.includes(i)} onChange={() => toggle(i)} />
              <span className="body">{t === '<openers>' ? openersLine : t}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
