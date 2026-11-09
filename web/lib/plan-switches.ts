// Plan changes made after Walker's 1:12 AM yes, built but off until he says yes to them. Each is
// one flag, off (the 1:12 AM copy) unless its NEXT_PUBLIC_ variable is "1" at build time, so a
// checker can turn it on for staging; at his yes the default flips to on. (The Playner's 4:18 AM Nov 9 mail: "Build them behind your switches ... and flip them
// at his yes.")
export const PLAN_SWITCHES = {
  /**
   * Item 75: the demo's words. On: the demo total and demo corner pages say "On a real meet night,
   * every woman who totaled is on the host's screen." with "Watch a meet night" (to /sample); the
   * total's Primary is "See my lifts" until phase 4; every red reason has a "Take it again" fix;
   * a squat sample standing in for another lift says so.
   */
  item75: process.env.NEXT_PUBLIC_PLAN_ITEM75 === '1',
  /**
   * Item 76: the platform's last gaps. On: the closed page's next block date comes from the next
   * real meet's `block_starts_on` (Spring 2027 is seeded); a card at exactly her cap says "the same
   * weight for just one" / "the same number"; "Back to the platform" is a Ghost; and "Waiting" sits
   * under its group on the 9-attempt row, not inside the slot.
   */
  item76: process.env.NEXT_PUBLIC_PLAN_ITEM76 === '1',
  /**
   * Item 77: the total page's last gaps. On: a demo lifter who bombs out reads "In a real meet, your
   * next meet would be free." and no free entry is set for her. (Its other part, the "<MEET> · YOUR
   * NINE ATTEMPTS" eyebrow after the nine, is what's built in both copies.)
   */
  item77: process.env.NEXT_PUBLIC_PLAN_ITEM77 === '1',
  /**
   * Item 78: the welcome sheet's Ghost is "Open my corner page" (it still opens a new tab, shown by
   * a mark LookieBot picks in look 5.14a), and screen readers hear "Open my corner page, opens in a
   * new tab". Off: the 1:12 AM copy's "Open my corner page in a new tab".
   */
  item78: process.env.NEXT_PUBLIC_PLAN_ITEM78 === '1',
  /**
   * Item 79: the cheer sheet's Eyebrow (5.4). On: "Cheer <card_name> · <Lift> <n>" over the four
   * cheers ("Cheer <first name> · today's session" for a training session). Off: the 1:12 AM copy's
   * sheet, with no Eyebrow. The sheet itself, a tap and no long-press, is in both copies.
   */
  item79: process.env.NEXT_PUBLIC_PLAN_ITEM79 === '1',
  /**
   * Item 80: she sees her cheers on meet weekend (5.24, 5.27, 5.28; look 5.10). On: a cheer banner on
   * /platform and /platform/total as each lands, any she missed when she comes back, no banner of any
   * kind from "I'm ready" until her result panel has settled, and "YOUR CORNER" on her total. Off:
   * the 1:12 AM copy, where cheers are kept but never shown to her, and a lights banner drops in at once.
   */
  item80: process.env.NEXT_PUBLIC_PLAN_ITEM80 === '1',
  /**
   * Item 81: the flight strip moves under "I'm ready" (5.24, look 5.8 "Place and height"). On: the
   * attempt card, "I'm ready", the links, then the strip 32 px under "Test your spot first", always up
   * to three rows, nothing measured. Off: the 1:12 AM copy's order, the strip above "I'm ready",
   * with as many rows as leave the button on the visible screen.
   */
  item81: process.env.NEXT_PUBLIC_PLAN_ITEM81 === '1',
} as const;
