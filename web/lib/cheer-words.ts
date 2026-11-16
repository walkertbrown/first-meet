// The cheers' words (plan 5.4, 5.24, 5.28; look 5.10), safe for the browser: the four cheers, a
// corner's first name, the cheer sheet's Eyebrow, and what she reads when cheers land.

export const CHEERS = {
  white_lights: 'White lights!',
  strong: 'Strong!',
  got_this: 'You\'ve got this',
  see_you: 'See you on the platform',
} as const;
export type CheerKind = keyof typeof CHEERS;
export const CHEER_KINDS = Object.keys(CHEERS) as CheerKind[];

/** A corner's first name: 1–30 characters, letters, spaces and ' or - only. Else null. */
export function cleanCornerName(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return /^[\p{L}' -]{1,30}$/u.test(t) && /\p{L}/u.test(t) ? t : null;
}

/**
 * The cheer sheet's Eyebrow (5.4, item 79): "Cheer <name> · <Lift> <n>" for an attempt, or
 * "Cheer <first name> · today's session" for a training session. The type sets the capitals.
 */
export const cheerEyebrow = (name: string, what: string | 'session') =>
  `Cheer ${name} · ${what === 'session' ? 'today\'s session' : what}`;

/** What she reads when a cheer lands (5.4): "<name> cheered: <cheer>", or "Someone in your corner …". */
export const cheerLine = (kind: CheerKind, name: string | null) =>
  `${name ?? 'Someone in your corner'} cheered: ${CHEERS[kind]}`;

/** A run of words, some Strong (look 5.10: each name is the Strong part). */
export type Part = { t: string; strong?: boolean };
export const partsText = (parts: Part[]) => parts.map(p => p.t).join('');

/** One cheer's banner (5.24): "**Dana** cheered: Strong!", or "**Someone in your corner** cheered: …". */
export const oneCheerParts = (kind: CheerKind, name: string | null): Part[] =>
  [{ t: name ?? 'Someone in your corner', strong: true }, { t: ` cheered: ${CHEERS[kind]}` }];

/**
 * Several cheers (5.24, "<names>, in the banner and on her total"): each person once, in the order of
 * their first cheer; no-name cheers are left out of the names; past `max` names, "and <k> more",
 * where k counts people. Nobody named: "Your corner cheered you on". The banner names 2, the total 5.
 */
export function cheeredYouOn(names: string[], max: number, tail = ''): Part[] {
  const end = ` cheered you on${tail}.`;
  if (!names.length) return [{ t: `Your corner cheered you on${tail}.` }];
  const shown = names.length > max ? names.slice(0, max) : names;
  const out: Part[] = [];
  shown.forEach((n, i) => {
    if (i > 0) out.push({ t: names.length > max || i < shown.length - 1 ? ', ' : ' and ' });
    out.push({ t: n, strong: true });
  });
  out.push({ t: names.length > max ? ` and ${names.length - max} more${end}` : end });
  return out;
}

/** "<n> cheers", "1 cheer" (5.24). */
export const cheerCount = (n: number) => `${n} ${n === 1 ? 'cheer' : 'cheers'}`;

/** One cheer as she reads it: who (an opaque key: the same person, the same key) and their name. */
export type HerCheer = { id: string; kind: CheerKind; who: string | null; name: string | null };

/** Each person once, in the order of their first cheer; a cheer with no name has no person. */
export function namesOf(list: Pick<HerCheer, 'who' | 'name'>[]): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const c of list) if (c.who && c.name && !seen.has(c.who)) { seen.add(c.who); out.push(c.name); }
  return out;
}

/** What a waiting set of cheers says in one banner (5.24): one cheer's line, or the names. */
export const waitingParts = (list: HerCheer[]): Part[] =>
  list.length === 1 ? oneCheerParts(list[0].kind, list[0].name) : cheeredYouOn(namesOf(list), 2);

/** "YOUR CORNER" on her total (5.28): the names line and "<n> cheers", or nothing with none. */
export function cornerBlock(list: HerCheer[]): { line: Part[]; count: string } | null {
  return list.length ? { line: cheeredYouOn(namesOf(list), 5, ' this weekend'), count: cheerCount(list.length) } : null;
}

