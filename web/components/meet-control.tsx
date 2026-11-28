'use client';
// Meet control's confirms (plan 5.35): "Close the platform" and "Make the board final" ask first, in a
// bottom sheet. Escape or Cancel closes it; the form posts only from the sheet's own button.
import { useEffect, useRef, useState } from 'react';

export function ConfirmPost({ meet, action, label, title, body, yes, disabled, ghost }:
  { meet: string; action: string; label: string; title: string; body?: string; yes: string; disabled?: boolean; ghost?: boolean }) {
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLButtonElement>('button[type=submit]')?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  return (
    <>
      <button type="button" className={ghost ? 'btn ghost' : 'btn'} disabled={disabled} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className="sheet-scrim" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby={`c-${action}`} ref={sheet}>
            <span className="grab" aria-hidden="true" />
            <h2 className="sheet-title" id={`c-${action}`}>{title}</h2>
            {body && <p className="body">{body}</p>}
            <form method="post" action="/api/host/control" className="try-actions">
              <input type="hidden" name="meet" value={meet} />
              <input type="hidden" name="do" value={action} />
              <button className="btn" type="submit">{yes}</button>
              <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
