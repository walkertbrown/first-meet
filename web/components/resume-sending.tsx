'use client';
// After the close (3.8, 3.11, item 85): a clip still saved on this phone keeps sending from her
// platform's closed or done page and her total page, not only from the attempt screen. Mounted only
// where no attempt screen is sending it, so a clip is never sent twice. When it lands, the page
// re-reads; if the meet window turns it away, she sees the 3.11 sheet.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { resumeAll, type UploadStatus } from '@/lib/stage/uploader';
import { WINDOW_WORDS } from '@/lib/stage/meet-words';
import { WindowText } from '@/components/window-words';

type Win = Extract<UploadStatus, { kind: 'window' }>;

export function ResumeSending({ anyJudged = true }: { anyJudged?: boolean }) {
  const router = useRouter();
  const [win, setWin] = useState<Win | null>(null);
  useEffect(() => {
    let on = true;
    const cancels: (() => void)[] = [];
    void resumeAll().then(list => {
      for (const s of list) {
        cancels.push(s.cancel);
        void s.done.then(r => {
          if (!on) return;
          if (r.kind === 'sent') router.refresh();
          else if (r.kind === 'window') { setWin(r); router.refresh(); }
        });
      }
      if (!on) cancels.forEach(c => c());
    }).catch(() => {});
    return () => { on = false; cancels.forEach(c => c()); };
  }, [router]);

  if (!win) return null;
  const closed = win.reason === 'after_close';
  const toTotal = !closed || anyJudged;
  return (
    <div className="sheet-scrim">
      <div className="bottom-sheet" role="alertdialog" aria-modal="true" aria-labelledby="rs-title">
        <h2 className="sheet-title" id="rs-title">{closed ? WINDOW_WORDS.closedTitle : WINDOW_WORDS.lateTitle}</h2>
        <p className="body">
          {closed
            ? (win.closesAt && <WindowText say={{ kind: 'closed', closesAt: win.closesAt }} />)
            : (win.deadline && <WindowText say={{ kind: 'late', deadline: win.deadline }} />)}
        </p>
        <div className="try-actions">
          <a className="btn" href={toTotal ? '/platform/total' : '/platform'}>{toTotal ? WINDOW_WORDS.seeTotal : WINDOW_WORDS.ok}</a>
        </div>
      </div>
    </div>
  );
}
