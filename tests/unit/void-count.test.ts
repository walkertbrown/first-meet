// Item 112 (plan 3.4b): the bench's voids in a row on one attempt, as the phone counts them when the server's answer
// hasn't come by the end of "Rack!"'s 900 ms.
import { beforeEach, describe, expect, it } from 'vitest';

// the phone's storage, in node
const store = new Map<string, string>();
Object.assign(globalThis, { localStorage: {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k), clear: () => store.clear(),
} });
import { bumpVoids, resetVoids, secondSheet, syncVoids, voidsInRow } from '../../web/lib/stage/void-count';

describe('voids in a row (item 112)', () => {
  beforeEach(() => { localStorage.clear(); resetVoids('a'); resetVoids('b'); });

  it('counts each attempt on its own, and filming through to Rack! starts it again', () => {
    expect(bumpVoids('a')).toBe(1);
    expect(bumpVoids('a')).toBe(2);
    expect(bumpVoids('b')).toBe(1);
    resetVoids('a');
    expect(bumpVoids('a')).toBe(1);
  });

  it('is kept on the phone across a reload', () => {
    bumpVoids('a'); bumpVoids('a');
    expect(localStorage.getItem('fm-voids-a')).toBe('2');
  });

  it("follows the server's count when it answers", () => {
    bumpVoids('a');
    syncVoids('a', 3);
    expect(bumpVoids('a')).toBe(4);
  });

  it("the sheet takes the server's count if it came in time, else the phone's; the second sheet from the second on", () => {
    expect(voidsInRow(null, 2)).toBe(2);
    expect(voidsInRow(1, 2)).toBe(1);
    expect(voidsInRow(3, 1)).toBe(3);
    expect([1, 2, 3, 4].map(secondSheet)).toEqual([false, true, true, true]);
  });
});
