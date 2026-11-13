// Item 94, plan 5.2: the demo meet's "Use a sample lift instead" is judged on the server (5.36), so it
// never loads the pose model or its wasm. Its frozen frame's marks are the server's points.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import samples from '../../content/samples/samples.json';

const meet = readFileSync(join(__dirname, '../../web/components/meet-attempt.tsx'), 'utf8');
const runSample = meet.slice(meet.indexOf('const runSample = useCallback('), meet.indexOf('const runResume = useCallback('));
const pose = readFileSync(join(__dirname, '../../web/lib/stage/pose-live.ts'), 'utf8');

describe('5.2: a demo sample never loads the pose model', () => {
  it('the sample path never touches the pose model', () => {
    expect(runSample.length).toBeGreaterThan(1000);
    for (const s of ['loadPoseModel', 'LivePose', 'DeepestFrames', '.detect(', 'deeperOf(']) expect(runSample).not.toContain(s);
  });
  it('the judged frame\'s marks are the server\'s pose at the judged moment', () => {
    expect(runSample).toContain('await getJson(`/api/attempts/${attempt.id}/frame`)');
    expect(runSample).toContain('return f ? { ...shot, t: f.ms, p: f.p, side: f.side } : shot;');
  });
  it('before the call, a sample holds its known judged frame from samples.json (The Playner, 13 Nov)', () => {
    expect(runSample).toContain('await seekTo(video, (clip?.judged_frame_ms ?? (ct.squat + ct.rack) / 2) / 1000)');
    for (const c of samples.clips as { id: string; judged_frame_ms?: number; meet: { command_times: Record<string, number> } }[]) {
      const ct = c.meet.command_times;
      expect(c.judged_frame_ms, c.id).toBeTypeOf('number');
      expect(c.judged_frame_ms!, c.id).toBeGreaterThan(ct.squat ?? ct.loaded ?? 0);
      expect(c.judged_frame_ms!, c.id).toBeLessThan(ct.rack);
    }
  });
  it('the model and its wasm load only when something asks for them, never on import', () => {
    expect(pose).toContain("const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');");
    expect(pose).not.toMatch(/^import [^t].*@mediapipe/m);
  });
});
