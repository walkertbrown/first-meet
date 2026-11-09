# The sample lifts

The clips "Watch a sample lift" plays on the Try a lift stage (plan 5.2, look 7),
and the demo meet's lifts (plan 5.36): the close call is only in the demo meet.
All three are on YouTube under the Creative Commons Attribution licence (CC BY 3.0,
"reuse allowed"; read on each video's page, the good and no lifts Nov 7, 2026,
the close call Nov 9, 2026). No one in them endorses First Meet.

Our changes to all three: trimmed to one lift, sound removed, scaled from 1920×1080 to
1280×720 and re-encoded as H.264. No crop, filter or grade.

| File | Kind | Source | Author | Licence | Cut from the source |
|---|---|---|---|---|---|
| `good-lift-wabba.mp4` | good lift | "Supported Squats", https://www.youtube.com/watch?v=4_MDTbRIO0I (July 5, 2018) | WABBA (@WabbaQualifications) | CC BY 3.0 | 20.8 s to 26.6 s |
| `no-lift-half-squat-motion.mp4` | no lift | "Mini Squats", https://www.youtube.com/watch?v=wqCvuhfRXRU (June 17, 2019) | Motion (@motion2067) | CC BY 3.0 | 13.9 s to 19.1 s |
| `close-call-wabba.mp4` | close call | "Squats", https://www.youtube.com/watch?v=1XQMlVq1sdI (July 4, 2018) | WABBA (@WabbaQualifications) | CC BY 3.0 | 39.0 s to 57.8 s |

- **The good lift:** a woman in a plain studio with a wooden floor, side-on,
  holding a chair back for balance, squats with her hip crease below her knee
  and stands. The judge gives three white lights.
- **The no lift:** a woman in a white studio, side-on, holding a chair back,
  does a mini squat. The video was made to show the mini squat, so a red for
  depth is the fault it demonstrates (plan 5.2: a red only on a clip made to
  demonstrate that fault). The judge gives three red lights for depth.
- **The close call:** a woman in a yellow studio with a wooden floor, side-on,
  squats with her hip crease right at her knee, holds the bottom for about
  16 s, and stands. Her depth is inside the judge's close band (within 0.10 of
  parallel, not 0.05 past it), so the judge gives a close call for depth
  (`borderline_depth`), never a red. "Rack!" is at 18 s, after she stands.

On the stage each clip opens on its first frame, held through the frame check
and "Stand tall and still.", and plays on "Squat!", so the lifter squats on the
command. Its last frame is held for "Rack!". `tests/unit/samples.test.ts` and
`tests/judge/judge.spec.ts` check all three calls and the trim: she goes down within
1.5 s of "Squat!", and the clip ends within 1 s of "Rack!".

Licence: https://creativecommons.org/licenses/by/3.0/
