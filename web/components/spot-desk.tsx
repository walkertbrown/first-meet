'use client';
// One lifter on /referee/spot (plan 5.33, look 5.13a): her place, the bot's line, Checked or Problem
// with its reasons, and her nine clips (squat, bench, deadlift by attempt). One clip plays at a time.
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { SpotProblem } from '@/db/schema';
import type { SpotDeskRow } from '@/lib/referee/spot-desk';

type Choice = 'checked' | 'problem' | null;
const key = (p: SpotProblem) => (p.kind === 'not_same_lifter' ? p.kind : `${p.kind}:${p.attemptId}`);

export function SpotLifter({ row, readOnly }: { row: SpotDeskRow; readOnly: boolean }) {
  const router = useRouter();
  const [choice, setChoice] = useState<Choice>(row.person?.outcome === 'checked' || row.person?.outcome === 'problem' ? row.person.outcome : null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set((row.person?.problems ?? []).map(key)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playing = useRef<HTMLVideoElement | null>(null);

  const options: SpotProblem[] = [
    ...row.clips.map(c => ({ kind: 'weight_not_visible' as const, attemptId: c.attemptId })),
    { kind: 'not_same_lifter' },
    ...row.clips.filter(c => c.press).map(c => ({ kind: 'arms_bent' as const, attemptId: c.attemptId })),
  ];
  const nameOf = (id: string) => row.clips.find(c => c.attemptId === id)?.name ?? 'an attempt';
  const words = (p: SpotProblem) => p.kind === 'not_same_lifter' ? 'Not the same lifter'
    : p.kind === 'weight_not_visible' ? `Weight not visible on ${nameOf(p.attemptId)}` : `Arms bent on ${nameOf(p.attemptId)}`;

  async function send(outcome: 'checked' | 'problem', problems: SpotProblem[]) {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/referee/spot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lifter_id: row.lifterId, outcome, problems }) });
      if (!r.ok) { setError(r.status === 409 ? 'The board is final, so this can’t change.' : 'That didn’t save. Try again.'); return; }
      setChoice(outcome); setOpen(false); router.refresh();
    } catch { setError('That didn’t save. Try again.'); } finally { setBusy(false); }
  }
  const toggle = (p: SpotProblem) => setPicked(s => { const n = new Set(s); const k = key(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  function play(v: HTMLVideoElement) {
    if (playing.current && playing.current !== v) playing.current.pause();
    playing.current = v;
  }

  return (
    <article className="spot-lifter">
      <div className="spot-side">
        <strong className="spot-place num">{row.place}</strong>
        <p className="small">{row.botLine}</p>
        <div className="spot-buttons">
          <button type="button" className="btn ghost small" aria-pressed={choice === 'checked'} disabled={readOnly || busy} onClick={() => send('checked', [])}>Checked</button>
          <button type="button" className="btn ghost small" aria-pressed={choice === 'problem'} aria-expanded={open} disabled={readOnly || busy} onClick={() => setOpen(o => !o)}>Problem</button>
        </div>
        {open && !readOnly && (
          <fieldset className="choices spot-reasons">
            <legend className="sr">What the problem is</legend>
            {options.map(p => (
              <label key={key(p)} className="choice">
                <input type="checkbox" checked={picked.has(key(p))} onChange={() => toggle(p)} />
                <span className="body">{words(p)}</span>
              </label>
            ))}
            <button type="button" className="btn small" disabled={busy || !picked.size}
              onClick={() => send('problem', options.filter(p => picked.has(key(p))))}>Save the problem</button>
          </fieldset>
        )}
        {error && <p className="small" role="alert">{error}</p>}
      </div>
      <div className="spot-clips">
        {row.clips.map(c => (
          <figure key={c.attemptId} className="spot-clip">
            <div className="spot-thumb">
              {c.video
                ? <video src={`${c.video}#t=0.1`} preload="metadata" muted playsInline controls onPlay={e => play(e.currentTarget)} aria-label={c.name} />
                : null}
            </div>
            <figcaption>
              <span className="spot-hud">{c.hud}</span>
              <span className="number-s num spot-weight">{c.weight}</span>
              <span className={`mini-lamp${c.light === 'off' ? '' : ` ${c.light}`}`} aria-label={c.light === 'red' ? 'Red light' : c.light === 'white' ? 'White light' : 'No light'} role="img" />
            </figcaption>
          </figure>
        ))}
      </div>
    </article>
  );
}
