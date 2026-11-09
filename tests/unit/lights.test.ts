// The referee's lamps (plan 5.33): the line above "Save the lights" names the first thing
// missing, in The Playner's order, and a red attempt carries one reason for the lifter.
import { describe, expect, it } from 'vitest';
import { attemptReason, callOf, saveLine } from '@/lib/lights';

describe('saveLine', () => {
  it('a lamp not set comes first, whatever else is missing', () => {
    expect(saveLine([null, null, null], [null, null, null], false, null)).toBe('Set all three lights to save.');
    expect(saveLine(['red', 'red', null], [null, null, null], true, null)).toBe('Set all three lights to save.');
  });

  it('one red without a reason, then two or three', () => {
    expect(saveLine(['white', 'red', 'white'], [null, null, null], false, null)).toBe('Pick a reason for the red light.');
    expect(saveLine(['red', 'red', 'white'], ['depth', null, null], false, null)).toBe('Pick a reason for each red light.');
    expect(saveLine(['red', 'red', 'red'], ['depth', 'depth', null], true, null)).toBe('Pick a reason for each red light.');
  });

  it('a reason left on a lamp that went white again does not count', () => {
    expect(saveLine(['white', 'red', 'white'], ['depth', null, null], false, null)).toBe('Pick a reason for the red light.');
  });

  it('Home: a red without its rep, after the reasons', () => {
    expect(saveLine(['red', 'white', 'white'], ['depth', null, null], true, null)).toBe('Tap the rep that got the red light.');
    expect(saveLine(['red', 'white', 'white'], ['depth', null, null], true, 3)).toBeNull();
    expect(saveLine(['white', 'white', 'white'], [null, null, null], true, null)).toBeNull();
  });

  it('nothing missing: the line goes', () => {
    expect(saveLine(['white', 'white', 'white'], [null, null, null], false, null)).toBeNull();
    expect(saveLine(['red', 'red', 'white'], ['depth', 'no_lockout', null], false, null)).toBeNull();
  });
});

describe('attemptReason', () => {
  it('two whites is a good lift', () => {
    expect(callOf(['white', 'red', 'white'])).toBe('white');
    expect(callOf(['red', 'white', 'red'])).toBe('red');
  });

  it('the reason most red lights gave', () => {
    expect(attemptReason(['red', 'red', 'red'], ['depth', 'no_lockout', 'depth'])).toBe('depth');
  });

  it('a tie goes to the head referee if red, else the first red from the left', () => {
    expect(attemptReason(['red', 'red', 'white'], ['depth', 'no_lockout', null])).toBe('no_lockout');
    expect(attemptReason(['red', 'white', 'red'], ['moved_feet', null, 'depth'])).toBe('moved_feet');
    expect(attemptReason(['red', 'red', 'red'], ['depth', 'no_lockout', 'moved_feet'])).toBe('no_lockout');
  });

  it('only red lamps count', () => {
    expect(attemptReason(['white', 'red', 'white'], ['depth', 'moved_feet', 'depth'])).toBe('moved_feet');
    expect(attemptReason(['white', 'white', 'white'], ['depth', null, null])).toBeNull();
  });
});
