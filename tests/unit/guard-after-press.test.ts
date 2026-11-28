// Item 116 (3.4b): the grinder run, and item 111's line with the guard on. The stuck guard after a normal "Press!",
// counting from "Press!" (Walker's yes, 1:03 AM), on every rep of the bench set, on the grid and at the live cadences,
// with scores as filmed and lifted to 0.995: no rep gets `rack_why: lost`, no "Rack!" comes earlier and no command
// moves against the guard off. No real pause of 0.5 s or more is blanked as filmed, and lifted to 0.995 none beyond
// what the guard off blanks (cab5cec).
import { describe, expect, it } from 'vitest';
import { RULES } from '../bench-commands/caller';
import { GUARD_CASES, guardCheck } from '../bench-commands/guard-after-press';
import { score } from '../bench-commands/score';

describe('the stuck guard after Press!, counting from Press! (item 116)', () => {
  it('is the setting in the rules', () => expect(RULES.guardAfterPress).toBe('from'));
  for (const cs of GUARD_CASES.filter(c => c.guard === 'from')) {
    it(`${cs.live ?? 'grid'}, ${cs.lift ? `scores lifted to ${cs.lift}` : 'scores as filmed'}: no lost, no earlier Rack!, no command moved, no pause blanked beyond the guard off`, () => {
      const g = guardCheck(cs);
      expect(g.reps).toBe(51);
      expect(g.lost).toEqual([]);
      expect(g.earlier).toEqual([]);
      expect(g.changed).toEqual([]);
      const off = score({ ...RULES, guardAfterPress: false }, undefined, { allReps: true, live: cs.live, lift: cs.lift }).rows
        .filter(r => r.pauseEnd - r.stop >= 0.5 && r.pauseStuck).map(r => r.id);
      if (!cs.lift) expect(g.blanked).toEqual([]);
      for (const id of g.blanked) expect(off).toContain(id);
    }, 120000);
  }
});
