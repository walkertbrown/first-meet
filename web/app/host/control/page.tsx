import '../../referee.css';
import '../../platform.css';
import { forbidden } from 'next/navigation';
import { Wordmark } from '@/components/chrome';
import { ConfirmPost } from '@/components/meet-control';
import { db } from '@/db';
import { controlMeet, etInput, etWords, statusMessage } from '@/lib/meet-control';
import { boardFinalReady } from '@/lib/meet-window';
import { platformOpen } from '@/lib/meet-flow';
import { currentViewer } from '@/lib/roles';

// /host/control (plan 5.35): meet control, for admins and the host.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Meet control', robots: { index: false } };

const SAVED: Record<string, string> = {
  open: 'The platform is open.', close: 'The platform is closed.', times: 'Times saved.', stream: 'Saved.',
  went_live: 'Saved.', live_minutes: 'Saved.', final: 'The board is final.', replay: 'Saved.', status: 'Saved.',
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const v = await currentViewer(db());
  if (!v || (!v.isHost && !v.isAdmin)) forbidden();
  const q = await searchParams;
  const meet = await controlMeet(db());
  const msg = await statusMessage(db());
  const said = (at: string) => q.at === at ? (q.note ?? (q.saved ? SAVED[q.saved] : null)) : null;
  const Said = ({ at }: { at: string }) => { const s = said(at); return s ? <p className="small control-said" role="status">{s}</p> : null; };
  if (!meet) {
    return (
      <div className="wrap page desk">
        <header className="topbar"><Wordmark /></header>
        <main><h1 className="page-title">Meet control</h1><p className="body">No meet yet.</p></main>
      </div>
    );
  }
  const open = platformOpen(meet);
  const final = meet.status === 'final';
  const ready = final ? null : await boardFinalReady(db(), meet);
  return (
    <div className="wrap page desk">
      <header className="topbar"><Wordmark /></header>
      <main className="control">
        <h1 className="page-title">Meet control</h1>
        <p className="body-l">{meet.name}{meet.kind === 'test' ? ' (test meet)' : ''}</p>

        <section className="control-section" aria-labelledby="c-platform">
          <h2 className="eyebrow" id="c-platform">PLATFORM</h2>
          <p className="body">{final ? 'The board is final.' : open ? 'The platform is open.' : 'The platform is closed.'}</p>
          {!final && (open
            ? <ConfirmPost action="close" label="Close the platform" title="Close the platform?" body="No one can start a lift after this. Clips already recorded can still arrive." yes="Close the platform" ghost />
            : <ConfirmPost action="open" label="Open the platform" title="Open the platform?" body="Lifters can start their meet attempts now." yes="Open the platform" />)}
          <Said at="open" /><Said at="close" />
          <form method="post" action="/api/host/control" className="control-form">
            <input type="hidden" name="do" value="times" />
            <label className="field"><span>Opens (Eastern)</span><input type="datetime-local" name="opens_at" defaultValue={etInput(meet.opensAt)} /></label>
            <label className="field"><span>Closes (Eastern)</span><input type="datetime-local" name="closes_at" defaultValue={etInput(meet.closesAt)} /></label>
            <label className="field"><span>Meet night live (Eastern)</span><input type="datetime-local" name="live_at" defaultValue={etInput(meet.liveAt)} /></label>
            <p className="small">Opens {etWords(meet.opensAt)} · closes {etWords(meet.closesAt)} · live {etWords(meet.liveAt)}</p>
            <button className="btn ghost" type="submit">Save the times</button>
            <Said at="times" />
          </form>
        </section>

        <section className="control-section" aria-labelledby="c-live">
          <h2 className="eyebrow" id="c-live">SOO&apos;S LIVE</h2>
          <form method="post" action="/api/host/control" className="control-form">
            <input type="hidden" name="do" value="stream" />
            <label className="field"><span>YouTube live video ID</span><input name="video_id" defaultValue={meet.streamVideoId ?? ''} autoComplete="off" spellCheck={false} /></label>
            <button className="btn ghost" type="submit">Save</button>
            <Said at="stream" />
          </form>
          <form method="post" action="/api/host/control" className="control-form">
            <input type="hidden" name="do" value="went_live" />
            <button className="btn" type="submit">Soo went live now</button>
          </form>
          <form method="post" action="/api/host/control" className="control-form">
            <input type="hidden" name="do" value="went_live" />
            <label className="field"><span>Went live at (Eastern)</span><input type="datetime-local" name="at" defaultValue={etInput(meet.streamStartedAt)} /></label>
            <button className="btn ghost" type="submit">Save</button>
            <Said at="went_live" />
          </form>
          <form method="post" action="/api/host/control" className="control-form">
            <input type="hidden" name="do" value="live_minutes" />
            <label className="field"><span>Live length (minutes)</span><input type="number" name="minutes" min={10} max={300} defaultValue={meet.liveMinutes} inputMode="numeric" /></label>
            <button className="btn ghost" type="submit">Save</button>
            <Said at="live_minutes" />
          </form>
        </section>

        <section className="control-section" aria-labelledby="c-board">
          <h2 className="eyebrow" id="c-board">BOARD</h2>
          {final ? <p className="body">The board is final. Results and awards are public.</p> : (
            <>
              <ConfirmPost action="final" label="Make the board final" title="Make the board final? Results and awards go public." yes="Make the board final" disabled={!ready?.ok} />
              {ready && !ready.ok && <p className="small">{ready.line ?? (ready.why === 'close_calls' ? 'Close calls are still waiting.' : 'Spot checks are still running.')}</p>}
            </>
          )}
          <Said at="final" />
          <form method="post" action="/api/host/control" className="control-form">
            <input type="hidden" name="do" value="replay" />
            <label className="field"><span>Replay video ID</span><input name="video_id" defaultValue={meet.replayVideoId ?? ''} autoComplete="off" spellCheck={false} /></label>
            <button className="btn ghost" type="submit">Save</button>
            <Said at="replay" />
          </form>
        </section>

        <section className="control-section" aria-labelledby="c-status">
          <h2 className="eyebrow" id="c-status">STATUS MESSAGE</h2>
          <form method="post" action="/api/host/control" className="control-form">
            <input type="hidden" name="do" value="status" />
            <label className="field"><span>Title</span><input name="title" maxLength={80} defaultValue={msg?.title ?? ''} /></label>
            <label className="field"><span>Sentence</span><textarea name="sentence" maxLength={280} rows={2} defaultValue={msg?.sentence ?? ''} /></label>
            <p className="small">Shown on /status. Leave both blank to clear it.</p>
            <button className="btn ghost" type="submit">Save</button>
            <Said at="status" />
          </form>
        </section>
      </main>
    </div>
  );
}
