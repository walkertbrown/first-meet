// The red-light reason cards (plan 3.5): the eyebrow, then the sentence she sees. The referee
// picks one of these when the lights are red (5.33). Kept free of server code so the referee's
// page can use it in the browser.

export type ReasonCode = 'depth' | 'no_lockout' | 'no_pause' | 'moved_feet' | 'downward' | 'weight_not_shown' | 'not_whole_lift';

export const REASON_EYEBROW: Record<ReasonCode, string> = {
  depth: 'DEPTH',
  no_lockout: 'LOCKOUT',
  no_pause: 'PAUSE',
  moved_feet: 'FEET',
  downward: 'HITCH',
  weight_not_shown: 'WEIGHT',
  not_whole_lift: 'FRAME',
};

/** The meet's sentence for a reason, on this lift and division. */
export function reasonSentence(code: ReasonCode, lift: string, division: string): string {
  switch (code) {
    case 'depth':
      return 'Almost. Your hips stopped just above your knees. Sit back a little further and take it again.';
    case 'no_lockout':
      return lift === 'bench'
        ? "Your arms didn't straighten all the way. Next time, press until your elbows lock and hold for the command."
        : "You didn't finish standing tall. Next time, stand all the way up and hold still for the command.";
    case 'no_pause':
      return division === 'home'
        ? "You pressed before the 'Press!' call. Next time, let your elbows rest on the floor, wait for the call, then press."
        : "You pressed before the 'Press!' call. Next time, let it rest on your chest, wait for the call, then press.";
    case 'moved_feet':
      return 'Your feet moved during the lift. Keep them planted from the command to the finish.';
    case 'downward':
      return 'The weight went down partway up. Next time, pull in one smooth line to standing.';
    case 'weight_not_shown':
      return "We couldn't see the weight clearly. On your next attempt, turn the plates or dumbbells toward the phone before you start.";
    case 'not_whole_lift':
      return "We couldn't see the whole lift. Check your spot before your next attempt.";
  }
}

/**
 * The reasons a referee can give on a lift (3.5's "who can give it"): depth is the squat's,
 * the pause is the press's, and a hitch (the weight going down partway up) is the deadlift's.
 */
export function refereeReasons(lift: string): ReasonCode[] {
  if (lift === 'squat') return ['depth', 'no_lockout', 'moved_feet', 'weight_not_shown', 'not_whole_lift'];
  if (lift === 'bench') return ['no_pause', 'no_lockout', 'moved_feet', 'weight_not_shown', 'not_whole_lift'];
  return ['no_lockout', 'downward', 'moved_feet', 'weight_not_shown', 'not_whole_lift'];
}

/** A Home red names the rep: "REP 6 · DEPTH". */
export const reasonEyebrow = (code: ReasonCode, rep: number | null) => (rep ? `REP ${rep} · ${REASON_EYEBROW[code]}` : REASON_EYEBROW[code]);
