// The status page's words (plan 5.7).
import { describe, expect, it } from 'vitest';
import { botWords, judgingWords, recordingTrouble, tenUp } from '@/lib/status';
import { updatedWords } from '@/components/status-age';

describe('/status', () => {
  it('judging: normal rounds up to the next 10 s; busy and paused say so', () => {
    expect(tenUp(41)).toBe(50);
    expect(tenUp(40)).toBe(40);
    expect(tenUp(3)).toBe(10);
    expect(judgingWords('normal', 41, 1)).toBe('Lights are taking about 50 seconds');
    expect(judgingWords('normal', null, 1)).toBe('Lights are taking about a minute');
    expect(judgingWords('busy', 30, 6)).toBe('Busy: lights are taking about 6 minutes');
    expect(judgingWords('paused', null, null)).toBe("Paused: your lifts are saved and will be judged when it's back");
  });
  it('the referee bot: waiting, and the minutes rounded up, at least 1', () => {
    expect(botWords(3, 61)).toBe('3 waiting · about 2 minutes');
    expect(botWords(0, null)).toBe('0 waiting · about 1 minute');
    expect(botWords(1200, 20)).toBe('1,200 waiting · about 1 minute');
  });
  it('recording has trouble only past 5% of uploads, and at least 3 failures', () => {
    expect(recordingTrouble(20, 2)).toBe(false);
    expect(recordingTrouble(100, 5)).toBe(false);
    expect(recordingTrouble(100, 6)).toBe(true);
    expect(recordingTrouble(0, 3)).toBe(true);
    // a failing database or R2 check is trouble whatever the counts (The Playner, Nov 28)
    expect(recordingTrouble(100, 0, false)).toBe(true);
  });
  it('the Small line', () => {
    expect(updatedWords(1)).toBe('Updated 1 second ago.');
    expect(updatedWords(12)).toBe('Updated 12 seconds ago.');
  });
});
