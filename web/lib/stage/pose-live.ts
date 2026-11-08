// MediaPipe Pose on a live <video> (her camera, or a sample clip), for the stage.
// The same pinned @mediapipe/tasks-vision and model the tests use (plan 2.2),
// with the wasm and model served from our own /models/, never a CDN.
import type { Pt } from '@/lib/judge';

type Landmark = { x: number; y: number; z: number; visibility?: number };
type Landmarker = {
  detectForVideo(v: HTMLVideoElement, timestampMs: number): { landmarks?: Landmark[][] };
  close(): void;
};

let loading: Promise<Landmarker> | null = null;

/** Loads the pose model once. Tries the GPU and falls back to the CPU. */
export function loadPoseModel(): Promise<Landmarker> {
  loading ??= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks('/models/wasm');
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/pose_landmarker_full.task', delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      }) as Promise<Landmarker>;
    try {
      return await make('GPU');
    } catch {
      return await make('CPU');
    }
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/** Finds the pose in the video's current frame. Timestamps must only go up, so it keeps its own clock. */
export class LivePose {
  private last = 0;
  /** Time spent finding poses, in ms, since the last reset (for /ops: the phone judge's time). */
  poseMs = 0;
  frames = 0;
  constructor(private lm: Landmarker) {}

  detect(v: HTMLVideoElement): Pt[] | null {
    const now = Math.max(this.last + 1, Math.round(performance.now()));
    this.last = now;
    const t0 = performance.now();
    const res = this.lm.detectForVideo(v, now);
    this.poseMs += performance.now() - t0;
    this.frames++;
    const p = res.landmarks?.[0];
    return p ? p.map(q => [q.x, q.y, q.visibility ?? 0, q.z] as Pt) : null;
  }

  resetClock() { this.poseMs = 0; this.frames = 0; }
}
