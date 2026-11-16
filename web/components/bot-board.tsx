'use client';
// The referee bot's lamp board (look 5.14d): three stacked rows, Left, Head, Right, on a
// `--stage` block that clips its own glow. Each row is the 56 px lamp and its words: the label,
// a red's reason eyebrow, and the bot's note. While it decides, the lamps are dark and pulse.
//
// `play`: the demo's bot page (5.36). The lamps light left, head, right, 330 ms apart with a
// thock, when the lights come in while she's on the page or the first time she opens a decided
// attempt on this device (`fm-bot-lit-<attempt>` in sessionStorage). Otherwise lit and settled.
import { useEffect, useRef, useState } from 'react';
import { reasonEyebrow, REASON_EYEBROW } from '@/lib/reason-words';
import { UNAVAILABLE_SMALL } from '@/lib/referee/words';
import { thock } from '@/lib/stage/thock';
import type { BotLamp, BotSide } from '@/lib/referee/bot-view';

const NAMES = ['Left', 'Head', 'Right'] as const;
const STEP_MS = 330;

const seenKey = (id: string) => `fm-bot-lit-${id}`;
function seen(id: string) {
  try { return window.sessionStorage.getItem(seenKey(id)) === '1'; } catch { return false; }
}
function markSeen(id: string) {
  try { window.sessionStorage.setItem(seenKey(id), '1'); } catch { /* it plays again next time */ }
}

/** "Left: white light. <note>" / "Right: red light, depth. <note>" (look 5.14d, screen readers). */
export function lampSpeech(name: string, l: BotLamp) {
  const reason = l.light === 'red' && l.reason ? `, ${REASON_EYEBROW[l.reason].toLowerCase()}` : '';
  return `${name}: ${l.light} light${reason}.${l.note ? ` ${l.note}` : ''}`;
}

export function BotBoard({ attemptId, side, play = false, looking }: {
  attemptId: string;
  side: BotSide;
  play?: boolean;
  /** The demo's Body line while it decides ("The referee bot is looking at this one."). */
  looking?: string;
}) {
  const lamps = side.state === 'decided' ? side.lamps : null;
  // How many lamps are lit. On the server and the first paint: none if this may play, else all.
  const [lit, setLit] = useState(lamps && !play ? 3 : 0);
  const [played, setPlayed] = useState(false);
  const [said, setSaid] = useState('');
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!lamps) { setLit(0); return; }
    if (!play || seen(attemptId)) { setLit(3); return; }
    markSeen(attemptId);
    setPlayed(true);
    setLit(0);
    timers.current = [0, 1, 2].map(k => window.setTimeout(() => {
      setLit(k + 1);
      thock(lamps[k].light === 'red');
      if (k === 2) setSaid(`The referee bot's lights: ${lamps.map(l => l.light).join(', ')}.`);
    }, k * STEP_MS));
    return () => { timers.current.forEach(t => window.clearTimeout(t)); };
    // `side` changes from deciding to decided once; its lamps don't change after
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side.state, play, attemptId]);

  const decided = side.state === 'decided';
  return (
    <>
      {looking !== undefined && (
        <div className={`bot-looking${decided ? ' gone' : ''}`} aria-hidden={decided}>
          <div><p className="body">{looking}</p></div>
        </div>
      )}
      <div className="bot-board">
        <ul className="bot-rows">
          {NAMES.map((name, i) => {
            const l = lamps && i < lit ? lamps[i] : null;
            const open = !!l && !!(l.note || (l.light === 'red' && l.reason));
            return (
              <li key={name} className={`bot-row${open ? ' open' : ''}`}>
                <i
                  className={`lamp bot-lamp${l ? ` ${l.light}${played ? '' : ' settled'}` : decided ? '' : ' pulse'}`}
                  aria-hidden="true"
                />
                <div className="bot-text" aria-hidden="true">
                  <span className="small bot-label">{name}</span>
                  <div className="bot-more">
                    <div>
                      {l?.light === 'red' && l.reason && <span className="eyebrow bot-reason">{reasonEyebrow(l.reason, l.rep)}</span>}
                      {l?.note && <p className="small bot-note">{l.note}</p>}
                    </div>
                  </div>
                </div>
                <span className="sr">{l ? lampSpeech(name, l) : `${name}: ${decided ? 'lighting' : 'deciding'}.`}</span>
              </li>
            );
          })}
        </ul>
        {side.state === 'decided' && side.unavailable && lit === 3 && <p className="small bot-unavailable">{UNAVAILABLE_SMALL}</p>}
      </div>
      <p className="sr" aria-live="polite">{said}</p>
    </>
  );
}
