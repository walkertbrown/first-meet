// The frame the stage holds, dimmed, during the held breath after a reload (5.25 step 8, look 7):
// the judged moment once there is one, else the frame halfway from the lift's first call
// ("Squat!", "Start!", or the soft command for a deadlift) to its end ("Rack!", "Down!"), the
// same stand-in the camera path uses when the phone's pose saw nothing.

export function heldFrameMs(ct: Record<string, number> | null | undefined, judgedMs?: number | null): number | null {
  if (typeof judgedMs === 'number') return judgedMs;
  if (!ct) return null;
  const end = ct.rack ?? ct.down;
  if (typeof end !== 'number') return null;
  const from = ct.squat ?? ct.start ?? ct.loaded ?? 0;
  return end > from ? Math.round((from + end) / 2) : null;
}
