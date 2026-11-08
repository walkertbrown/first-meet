// The phone's judge time for one Try a lift clip (plan piece 1, 2.4). Phase 1 writes it as a
// structured JSON line to Render's log stream; phase 2 also saves it as an `events` row. Never
// the video, a picture or the pose points, and nothing that names her.
export type JudgeTime = {
  source: 'sample' | 'camera';
  clipMs: number;
  poseMs: number;
  frames: number;
  /** The phone's screen, in CSS pixels. */
  screenW: number;
  screenH: number;
  /** The recorded video's size in bytes (null for a sample lift: nothing was recorded). */
  bytes: number | null;
  /** The browser and the phone's model, from the user agent. */
  device: string;
};

const MAX_MS = 10 * 60_000;
const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : null);

/** The report, checked and trimmed, or null if it isn't one. */
export function parseJudgeTime(body: unknown): JudgeTime | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.source !== 'sample' && b.source !== 'camera') return null;
  const clipMs = int(b.clipMs, MAX_MS), poseMs = int(b.poseMs, MAX_MS), frames = int(b.frames, 100_000);
  const screenW = int(b.screenW, 20_000), screenH = int(b.screenH, 20_000);
  const bytes = b.bytes === null || b.bytes === undefined ? null : int(b.bytes, 2_000_000_000);
  if (clipMs === null || poseMs === null || frames === null || screenW === null || screenH === null) return null;
  if (bytes === null && b.bytes !== null && b.bytes !== undefined) return null;
  const device = typeof b.device === 'string' ? b.device.replace(/[^\x20-\x7E\u00B7]/g, '').slice(0, 80) : '';
  return { source: b.source, clipMs, poseMs, frames, screenW, screenH, bytes, device: device || 'unknown' };
}

/** The log line: one JSON object, `kind: phone_judge_time` (the `events` kind in phase 2). */
export function judgeTimeLine(j: JudgeTime, at = new Date()): string {
  return JSON.stringify({ at: at.toISOString(), kind: 'phone_judge_time', ...j, poseMsPerClipSec: j.clipMs ? Math.round(j.poseMs / (j.clipMs / 1000)) : null });
}
