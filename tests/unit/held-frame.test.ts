import { describe, expect, it } from 'vitest';
import { heldFrameMs } from '../../web/lib/stage/held-frame';

describe('the held breath\'s frame after a reload (5.25 step 8, look 7)', () => {
  it('is the judged moment once there is one', () => {
    expect(heldFrameMs({ loaded: 0, squat: 1000, rack: 5000 }, 2400)).toBe(2400);
  });
  it('is halfway from the first call to the end, for each lift', () => {
    expect(heldFrameMs({ loaded: 0, squat: 1000, rack: 5000 })).toBe(3000);
    expect(heldFrameMs({ loaded: 0, start: 800, press: 2500, rack: 4000 })).toBe(2400);
    expect(heldFrameMs({ loaded: 0, down: 3000 })).toBe(1500);
  });
  it('is null without command times, so the phone takes the clip\'s middle', () => {
    expect(heldFrameMs(null)).toBeNull();
    expect(heldFrameMs({ loaded: 0 })).toBeNull();
  });
});
