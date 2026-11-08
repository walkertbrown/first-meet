// Piece 1: the phone's judge time for each Try a lift clip, by device (web/lib/judge-time.ts).
import { describe, expect, it } from 'vitest';
import { judgeTimeLine, parseJudgeTime } from '../../web/lib/judge-time';

const ok = { source: 'camera', clipMs: 10_000, poseMs: 6_200.4, frames: 290, screenW: 412, screenH: 915, bytes: 4_200_000, device: 'Chrome 142 · Android 14 Pixel 7' };

describe('the judge time report', () => {
  it('takes a whole report and rounds it', () => {
    expect(parseJudgeTime(ok)).toEqual({ ...ok, poseMs: 6200 });
  });
  it('turns away anything that is not one', () => {
    expect(parseJudgeTime(null)).toBeNull();
    expect(parseJudgeTime({ ...ok, source: 'upload' })).toBeNull();
    expect(parseJudgeTime({ ...ok, clipMs: -1 })).toBeNull();
    expect(parseJudgeTime({ ...ok, frames: 'many' })).toBeNull();
    expect(parseJudgeTime({ ...ok, poseMs: Infinity })).toBeNull();
    expect(parseJudgeTime({ ...ok, bytes: 'big' })).toBeNull();
  });
  it('takes a sample lift, which has no video bytes', () => {
    expect(parseJudgeTime({ ...ok, source: 'sample', bytes: null })).toMatchObject({ source: 'sample', bytes: null });
  });
  it('keeps only the fields in plan 2.4', () => {
    expect(Object.keys(parseJudgeTime({ ...ok, email: 'x', points: [1, 2] })!).sort()).toEqual(['bytes', 'clipMs', 'device', 'frames', 'poseMs', 'screenH', 'screenW', 'source']);
  });
  it('keeps the device short and printable', () => {
    expect(parseJudgeTime({ ...ok, device: 'x'.repeat(200) })!.device).toHaveLength(80);
    expect(parseJudgeTime({ ...ok, device: 'a\nb\u0000c' })!.device).toBe('abc');
    expect(parseJudgeTime({ ...ok, device: undefined })!.device).toBe('unknown');
  });
  it('writes one JSON line with the device and the pose time per clip second', () => {
    const line = judgeTimeLine(parseJudgeTime(ok)!, new Date('2026-11-07T00:00:00Z'));
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toMatchObject({ kind: 'phone_judge_time', device: 'Chrome 142 · Android 14 Pixel 7', clipMs: 10_000, poseMsPerClipSec: 620 });
  });
});
