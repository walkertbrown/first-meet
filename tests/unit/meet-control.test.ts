// Meet control (plan 5.35): the form's fields, the video IDs and the Eastern times.
import { describe, expect, it } from 'vitest';
import { etFromInput, etInput, parseControl, youtubeId } from '@/lib/meet-control';

describe('YouTube video IDs', () => {
  it('takes the ID itself or a pasted link', () => {
    for (const s of ['dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3s', 'youtu.be/dQw4w9WgXcQ', 'https://youtube.com/live/dQw4w9WgXcQ?feature=share', 'https://m.youtube.com/embed/dQw4w9WgXcQ'])
      expect(youtubeId(s), s).toBe('dQw4w9WgXcQ');
  });
  it('refuses anything else', () => {
    for (const s of ['', 'short', 'https://vimeo.com/123456789', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ<'])
      expect(youtubeId(s), s).toBeNull();
  });
});

describe('Eastern times in the form', () => {
  it('round-trips winter and summer times', () => {
    expect(etFromInput('2027-02-26T06:00')!.toISOString()).toBe('2027-02-26T11:00:00.000Z');
    expect(etFromInput('2027-07-01T20:30')!.toISOString()).toBe('2027-07-02T00:30:00.000Z');
    expect(etInput(new Date('2027-02-27T23:00:00Z'))).toBe('2027-02-27T18:00');
  });
  it('moves a skipped hour on, and refuses nonsense', () => {
    expect(etFromInput('2027-03-14T02:30')!.toISOString()).toBe('2027-03-14T06:30:00.000Z');
    expect(etFromInput('2027-13-01T00:00')).toBeNull();
    expect(etFromInput('tomorrow')).toBeNull();
  });
});

describe("the form's actions", () => {
  const form = (o: Record<string, string>) => (k: string) => o[k] ?? null;
  it('says what is wrong', () => {
    expect(parseControl(form({ do: 'times', opens_at: '2027-02-26T06:00', closes_at: '2027-02-26T05:00' }))).toEqual({ error: 'The platform has to close after it opens.' });
    expect(parseControl(form({ do: 'stream', video_id: 'nope' }))).toEqual({ error: "That isn't a YouTube video ID or link." });
    expect(parseControl(form({ do: 'live_minutes', minutes: '5' }))).toEqual({ error: 'Live length is 10 to 300 minutes.' });
    expect(parseControl(form({ do: 'launch' }))).toEqual({ error: 'Unknown action.' });
  });
  it('"Soo went live now" is now; the field edits it', () => {
    const now = new Date('2027-02-28T01:00:00Z');
    expect(parseControl(form({ do: 'went_live' }), now)).toEqual({ do: 'went_live', at: now });
    expect(parseControl(form({ do: 'went_live', at: '2027-02-27T20:02' }), now)).toEqual({ do: 'went_live', at: new Date('2027-02-28T01:02:00Z') });
  });
  it('a blank video ID clears it', () => {
    expect(parseControl(form({ do: 'replay', video_id: ' ' }))).toEqual({ do: 'replay', id: null });
  });
});
