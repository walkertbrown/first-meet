// 5.30's words, shared by the server page and the card screen in her browser (no database here).
export const CARD_WORDS = {
  title: 'Your meet card',
  segments: ['Story', 'Post', 'Clip', 'Print'] as const,
  share: 'Share',
  save: 'Save to my phone',
  copy: 'Copy my card link',
  copied: 'Copied',
  making: 'Your clip is being made. It takes about a minute.',
  /** "Only the judges" (item 99): before she shares the clip, then after. */
  onlyYou: 'Your clip is only for you until you share it. Sharing it makes this clip, and only this clip, public.',
  shared: 'Your clip is on your card link now. Anyone with the link can watch it.',
  /** A clip that couldn't be made (item 102, look 5.15): never red. */
  failedTitle: "Your clip couldn't be made.",
  failedBody: 'Your card is ready to share. You can try the clip again.',
  failedFinal: "We've told the team.",
  tryAgain: 'Try again',
  print: 'Print',
  pdf: 'Or choose Save as PDF in the print window.',
} as const;
export type CardSegment = (typeof CARD_WORDS.segments)[number];
