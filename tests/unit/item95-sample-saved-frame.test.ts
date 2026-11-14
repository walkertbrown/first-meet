// Item 95 (3.4, piece 6): a demo sample's frame is its saved one. The server stores and sends samples.json's
// judged_frame_ms with its own points there; the worker test checks the band, not "within 67 ms"; the demo
// test reads the frozen frame's moment from the stage.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { poseAt, type Frame, type Pt } from '../../web/lib/judge';

const read = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');
const pt = (y: number): Pt[] => Array.from({ length: 33 }, () => [0.5, y, 0.9] as unknown as Pt);

describe('item 95: a demo sample\'s frame is its saved one', () => {
  it('the queue stores a sample\'s saved frame, and her own lifts keep the judge\'s', () => {
    const q = read('web/lib/queue.ts');
    expect(q).toContain('const saved = a.isSampleClip ? await sampleOfAttempt(db, a.id, a.commandTimes).then(s => (s ? sampleJudgedMs(s.id) : null)) : null;');
    expect(q).toContain('const judgedFrameMs = saved ?? v.judgedFrameMs;');
    expect(q).toContain('measures: { ...v.measures, commit: p.commit ?? null }, judgedFrameMs,');
  });
  it('the frame route and the worker test take the pose nearest the frame the same way', () => {
    const frames: Frame[] = [{ t: 3733, p: pt(0.1) }, { t: 3800, p: null }, { t: 3867, p: pt(0.3) }, { t: 4000, p: pt(0.4) }];
    // the nearest frame with a pose: 3800 has none, so 3733 (the first of the two 67 ms away)
    expect(poseAt(frames, 3800)!.t).toBe(3733);
    expect(poseAt(frames, 3990)!.t).toBe(4000);
    expect(poseAt([{ t: 0, p: null }], 0)).toBeNull();
    expect(read('web/lib/attempt-state.ts')).toContain('const best = poseAt(poses?.frames ?? [], ms);');
  });
  it('the worker test checks the band at the saved frame, and no longer the 67 ms check', () => {
    const w = read('tests/worker/worker.test.ts');
    expect(w).toContain('const at = poseAt(frames, saved!);');
    // the marks are drawn at exactly the frame the stage holds (NerdCider, 13 Nov)
    expect(w).toContain('the server has a pose at exactly the saved ${saved} ms (nearest: ${at!.t} ms)`).toBe(saved);');
    expect(w).toContain("if (s.kind === 'no') expect(depth, band).toBeLessThan(RULES.squat.redDepthMax);");
    expect(w).toContain("if (s.kind === 'good') expect(depth, band).toBeGreaterThan(RULES.squat.whiteDepthMin);");
    expect(w).not.toContain('the worker\'s ${v.measures.judged_frame_ms} ms`).toBeLessThanOrEqual');
  });
  it('the stage marks its frozen frame with its moment in the clip, for the 5-run demo test', () => {
    const m = read('web/components/meet-attempt.tsx');
    expect(m).toContain('fc.dataset.ms = String(Math.round(snap.t));');
    expect(m).toContain("return { t: Math.round(video.currentTime * 1000), depth: 0, p: [], canvas: c, side: 'left' };");
    expect(read('tests/e2e/demo-meet.spec.ts')).toContain("test('each demo sample 5 times: the stage freezes on its saved frame, and it never moves'");
  });
});
