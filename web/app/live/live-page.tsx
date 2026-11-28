// /live and /live/<meet> (plan 5.6; signed in, 5.29): always Lights down. Before `live_at` a countdown
// and the board; from it the stream, the count, the ticker and the board; after it, the final results
// title and the replay. Awards once the board is final. A signed-in lifter in this meet gets her row
// marked, her place card, and her name on Soo's live as it happens.
import { Footer, Wordmark } from '@/components/chrome';
import { LightsDown } from '@/components/lights-down';
import { LiveBoard, LiveCountdown, LivePoll } from '@/components/live-night';
import { SooReadouts } from '@/components/soo-readout';
import { Ticker } from '@/components/ticker';
import { db } from '@/db';
import { awards, boardRows, ordinal, placeOf, type BoardLifter } from '@/lib/board';
import { meetLifters, type MeetRow } from '@/lib/host-data';
import { BOARD_EMPTY } from '@/components/board';
import { latestLights, livePhase, liveWhen, meetEyebrow, noStreamYet } from '@/lib/live-page';
import { currentViewer } from '@/lib/roles';

export async function LivePage({ meet }: { meet: MeetRow }) {
  const [viewer, list, ticker] = await Promise.all([currentViewer(db()), meetLifters(db(), meet.id), latestLights(db(), meet.id)]);
  const phase = livePhase(meet);
  const final = meet.status === 'final';
  const me = viewer ? list.find(l => l.id === viewer.id) ?? null : null;
  const mine = me ? placeOf(boardRows(list, me.division), me.id) : null;
  const totals = boardRows(list, 'barbell').length + boardRows(list, 'home').length;
  const video = phase === 'after' ? meet.replayVideoId ?? meet.streamVideoId : meet.streamVideoId;
  const won = final ? awards(list) : [];
  // the board gets only what it draws: no emails, no say-it, no lines
  const board: BoardLifter[] = list.map(l => ({ id: l.id, name: l.name, ageGroup: l.ageGroup, age: l.age, division: l.division, units: l.units, attempts: l.attempts }));
  return (
    <div className="wrap page live-page">
      <LightsDown />
      <LivePoll />
      {me && <SooReadouts />}
      <header className="topbar"><Wordmark /></header>
      <main>
        <span className="eyebrow">{meetEyebrow(meet.name)}</span>
        {phase === 'before' ? (
          <>
            {meet.liveAt ? <LiveCountdown at={meet.liveAt.toISOString()} /> : <h1 className="page-title">Soo is live on meet night</h1>}
            {meet.liveAt && <p className="body-l">{liveWhen(meet.liveAt)}</p>}
          </>
        ) : (
          <>
            <h1 className="page-title">{phase === 'after' ? `${meet.name} · final results` : 'Soo is live'}</h1>
            <figure className="live-stream">
              <div className="live-frame">
                {video
                  ? <iframe src={`https://www.youtube-nocookie.com/embed/${video}`} title={phase === 'after' && meet.replayVideoId ? "Soo's meet night replay" : "Soo's meet night live"}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
                  : <p className="body live-wait">{noStreamYet(meet.liveAt)}</p>}
              </div>
              <figcaption className="caption">Love Soo on YouTube</figcaption>
            </figure>
          </>
        )}

        {mine && me && (
          <div className="card live-me">
            <p className="body-l">You&apos;re {ordinal(mine.place)} in {me.division === 'home' ? 'Home' : 'Barbell'} · {mine.ageGroup}.</p>
          </div>
        )}

        {phase !== 'before' && (
          <div className="live-now">
            <div className="live-count">
              <span className="eyebrow">FIRST TOTALS TONIGHT</span>
              <span className="weight-m num">{totals.toLocaleString('en-US')}</span>
            </div>
            <div>
              <h2 className="eyebrow">LATEST LIGHTS</h2>
              {ticker.length ? <Ticker items={ticker} /> : <p className="small">No lights yet.</p>}
            </div>
          </div>
        )}

        {won.length > 0 && (
          <section className="live-awards" aria-labelledby="live-awards-h">
            <h2 className="eyebrow" id="live-awards-h">AWARDS</h2>
            <ul className="award-cards">
              {won.map(a => (
                <li key={`${a.kind}-${a.division}-${a.ageGroup}-${a.lifterId}`} className="card">
                  <span className="eyebrow">{a.title}</span>
                  <p className="body-l">{a.name}</p>
                  <p className="small">{a.division === 'home' ? 'Home' : 'Barbell'} · {a.ageGroup}</p>
                  <p className="body">{a.reason}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <LiveBoard lifters={board} meId={me?.id ?? null} start={me?.division ?? 'barbell'}
          empty={meet.opensAt && meet.opensAt <= new Date() ? 'No totals yet.' : BOARD_EMPTY} />
      </main>
      <Footer />
    </div>
  );
}
