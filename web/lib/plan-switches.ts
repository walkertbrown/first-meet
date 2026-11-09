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
} as const;
