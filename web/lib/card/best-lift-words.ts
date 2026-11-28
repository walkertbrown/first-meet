// 5.28's "YOUR BEST LIFT" words and the clip's length, for the page and its client block (item 101).

/** "Play · 0:14": the clip's length, m:ss. */
export const playLength = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** 5.28's words for the block. A bomb-out has no card, so the failed Body is only "You can try the clip again." */
export const BEST_LIFT_WORDS = {
  eyebrow: 'YOUR BEST LIFT',
  play: 'Play your best lift',
  making: 'Your clip is being made. It takes about a minute.',
  failedTitle: "Your clip couldn't be made.",
  failedBody: 'You can try the clip again.',
  failedFinal: "We've told the team.",
  tryAgain: 'Try again',
  share: 'Share',
  sharing: 'Sharing',
  save: 'Save to my phone',
} as const;
