// The sample meet's drawn lifters (plan 5.3, chapter 2; look 7, "the sample meet's figures"): the
// how-to figure on --stage, side-on and faceless, at the judged moment: the bottom of a squat, the
// touch on a bench, the lockout of a deadlift. The figure's grid: a 0 0 120 120 viewBox, the floor
// at y = 108, a head of radius 7 (outline only), torso 34, thigh 26, shin 26, upper arm 18,
// forearm 16, one line per segment; the plate is a filled disc of radius 13. Drawn in --stage-ink
// with a 2.5 px stroke. As in LookieBot's lift icons (public/lifts.svg), the squat's plate sits at
// the top of the torso with the head just clear of it, and the squat has no arms; an arm crossing
// the plate gets a thin --stage edge so it reads in front. A made-up figure, never a person.
import type { Lift } from '@/db/schema';

type P = [number, number];
const seg = (a: P, b: P, k: string) => <line key={k} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
/** The point `len` from `o` at `deg` clockwise from straight up. */
const at = (o: P, len: number, deg: number): P => [o[0] + len * Math.sin((deg * Math.PI) / 180), o[1] - len * Math.cos((deg * Math.PI) / 180)];
type Pose = { ankle: P; knee: P; hip: P; shoulder: P; head: P; plate: P; arm: [P, P] | null; bench?: boolean };

/** The joints at the judged moment, facing right. `high`: a squat whose hips stopped above the knees. */
export function liftPose(lift: Lift, high = false): Pose {
  if (lift === 'bench') {
    // on her back on the bench, feet flat; the bar touching her chest, elbows below it
    const shoulder: P = [36, 79], hip = at(shoulder, 34, 90), knee: P = [93, 85], ankle: P = [95, 108];
    const head = at(shoulder, 12, 274), elbow = at(shoulder, 18, 100), hand = at(elbow, 16, 0);
    return { ankle, knee, hip, shoulder, head, plate: hand, arm: [elbow, hand], bench: true };
  }
  if (lift === 'deadlift') {
    // standing tall at lockout, arms straight down in front, the bar against her thighs
    const ankle: P = [56, 108], knee = at(ankle, 26, 2), hip = at(knee, 26, -2), shoulder = at(hip, 34, -3);
    const head = at(shoulder, 12, 4), elbow = at(shoulder, 18, 172), hand = at(elbow, 16, 178);
    return { ankle, knee, hip, shoulder, head, plate: hand, arm: [elbow, hand] };
  }
  // the bottom of a squat: shins forward, hips back and down, chest leaning over the feet
  const ankle: P = [54, 108], knee = at(ankle, 26, 36);
  const hip = at(knee, 26, high ? -72 : -97);
  const lean = high ? 28 : 38;
  const shoulder = at(hip, 34, lean);
  return { ankle, knee, hip, shoulder, head: at(shoulder, 22, lean + 12), plate: shoulder, arm: null };
}

export function LiftFigure({ lift, high = false, className = 'lift-figure' }: { lift: Lift; high?: boolean; className?: string }) {
  const j = liftPose(lift, high);
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true">
      <line className="floor" x1="0" y1="108" x2="120" y2="108" />
      <g className="body">
        {j.bench && <>{seg([18, 86], [86, 86], 'pad')}{seg([26, 86], [26, 108], 'l1')}{seg([78, 86], [78, 108], 'l2')}</>}
        {seg([j.ankle[0] - 3, 107], [j.ankle[0] + 9, 107], 'foot')}
        {seg(j.ankle, j.knee, 'shin')}
        {seg(j.knee, j.hip, 'thigh')}
        {seg(j.hip, j.shoulder, 'torso')}
        <circle className="head" cx={j.head[0]} cy={j.head[1]} r="7" />
      </g>
      <circle className="plate" cx={j.plate[0]} cy={j.plate[1]} r="13" />
      {j.arm && (
        <>
          <g className="halo">{seg(j.shoulder, j.arm[0], 'u')}{seg(j.arm[0], j.arm[1], 'f')}</g>
          <g className="body">{seg(j.shoulder, j.arm[0], 'upper')}{seg(j.arm[0], j.arm[1], 'fore')}</g>
        </>
      )}
    </svg>
  );
}
