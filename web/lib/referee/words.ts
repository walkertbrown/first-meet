// Who gives the lights to close calls and benches, in her words (plan item 88, 3.4d step 14 /
// item 103). With REFEREE_BOT off, close calls and benches wait in /referee for a person, and the
// words say "a referee", "usually within 15 minutes". With it on, they say "the referee bot",
// "usually within a few minutes", and the privacy words say frames go to Anthropic.
// No database here: the stage, the corner and the landing read it.

export const botOn = (env: Record<string, string | undefined> = process.env) => env.REFEREE_BOT === 'on';

/** 3.4d step 7: what a lift the referee bot couldn't look at shows under its three whites. */
export const UNAVAILABLE_SMALL = "The referee bot couldn't look at this one, so it counts.";

const PERSON = {
  closeBody: 'A referee is looking at this one, usually within 15 minutes. You can take your next attempt while you wait.',
  benchTitle: 'To a referee',
  benchBody: 'A referee judges every bench from your video, usually within 15 minutes. You can take your next attempt while you wait.',
  benchSending: 'Sending to the referee',
  looking: 'A referee is looking at this one',
  waitingBody: (lift: string) => `A referee is still looking at ${lift}. Your total lands as soon as they're done. Usually within 15 minutes.`,
  waitingFor: 'waiting for a referee',
  tryClose: 'That one was right on the line. In a meet, a referee would decide it. Try once more and sit a little deeper.',
  faqVideos: 'In Try a lift and training, nobody: your phone judges you and nothing is uploaded. Your meet attempts are seen by the judge, the referees and, if you choose, your corner. You can delete every video any time.',
  refereeLink: "See the referee's side of this close call",
  benchRefereeLink: "See the referee's side of this bench",
} as const;

const BOT: { [K in keyof typeof PERSON]: (typeof PERSON)[K] extends string ? string : (typeof PERSON)[K] } = {
  // 5.25 step 9 and 3.12's table
  closeBody: 'The referee bot is looking at this one, usually within a few minutes. You can take your next attempt while you wait.',
  benchTitle: 'To the referee bot',
  benchBody: 'The referee bot judges every bench from your video, usually within a few minutes. You can take your next attempt while you wait.',
  benchSending: 'Sending to the referee bot',
  looking: 'The referee bot is looking at this one',
  // 5.28
  waitingBody: (lift: string) => `The referee bot is still looking at ${lift}. Your total lands as soon as it's done, usually within a few minutes.`,
  waitingFor: 'waiting for the referee bot',
  // 5.2
  tryClose: 'That one was right on the line. In a meet, the referee bot would decide it. Try once more and sit a little deeper.',
  // 5.1's FAQ
  faqVideos: 'In Try a lift and training, nobody: your phone judges you and nothing is uploaded. Your meet attempts are seen by the judge and the referee bot (both computers; still frames go to Anthropic, whose AI the referee bot uses) and, if you choose, your corner. You can delete every video any time.',
  // 5.36: the demo's close call goes to the bot, and she sees how it called it
  refereeLink: 'See how the referee bot called it',
  benchRefereeLink: 'See how the referee bot called it',
};

export type RefereeWords = typeof BOT;
export const refereeWords = (bot: boolean): RefereeWords => (bot ? BOT : PERSON);
