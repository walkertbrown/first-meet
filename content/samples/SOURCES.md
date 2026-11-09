# The sample lifts

The clips "Watch a sample lift" plays on the Try a lift stage (plan 5.2, look 7),
and the demo meet's lifts (plan 5.36): the close call is only in the demo meet.
No one in them endorses First Meet.

- The good and no lifts are on YouTube under the Creative Commons Attribution
  licence (CC BY 3.0, "reuse allowed"; read on each video's page Nov 7, 2026).
- The close call is from Pexels, under the Pexels licence: free to use, no
  attribution required, and it may be modified (read Nov 7, 2026,
  https://www.pexels.com/license/). Its credit on the stage is "Pexels" (5.2:
  where no credit is needed, the credit is the site's name). It was chosen by
  The Playner on Nov 9, 2026, under 5.2. It replaces the WABBA "Squats" clip,
  which LookieBot turned down because its 15 s hold at the bottom isn't a lift.

Our changes to all three: trimmed to one lift, sound removed, scaled to 720p
(the good and no lifts from 1920×1080 to 1280×720, the close call, filmed tall,
from 1080×1920 to 720×1280) and re-encoded as H.264. No crop, filter or grade.

| File | Kind | Source | Author | Licence | Cut from the source |
|---|---|---|---|---|---|
| `good-lift-wabba.mp4` | good lift | "Supported Squats", https://www.youtube.com/watch?v=4_MDTbRIO0I (July 5, 2018) | WABBA (@WabbaQualifications) | CC BY 3.0 | 20.8 s to 26.6 s |
| `no-lift-half-squat-motion.mp4` | no lift | "Mini Squats", https://www.youtube.com/watch?v=wqCvuhfRXRU (June 17, 2019) | Motion (@motion2067) | CC BY 3.0 | 13.9 s to 19.1 s |
| `close-call-pexels.mp4` | close call | "Woman doing a squat exercise", https://www.pexels.com/video/woman-doing-a-squat-exercise-5025965/ (file 5025965-hd_1080_1920_25fps.mp4) | olia danilevich | Pexels licence | 5.8 s to 8.1 s |

- **The good lift:** a woman in a plain studio with a wooden floor, side-on,
  holding a chair back for balance, squats with her hip crease below her knee
  and stands. The judge gives three white lights.
- **The no lift:** a woman in a white studio, side-on, holding a chair back,
  does a mini squat. The video was made to show the mini squat, so a red for
  depth is the fault it demonstrates (plan 5.2: a red only on a clip made to
  demonstrate that fault). The judge gives three red lights for depth.
- **The close call:** a woman in a park, side-on, filmed tall, stands, does one
  bodyweight squat with her hip crease right at her knee, and stands. Her depth
  is inside the judge's close band (within 0.10 of parallel, not 0.05 past it),
  so the judge gives a close call for depth (`borderline_depth`), never a red.
  The cut starts at 5.8 s, not The Playner's 5.4 s: before 5.8 s she is still
  rising from the rep before, and the stage holds the first frame through
  "Stand tall and still.", which needs her standing. "Rack!" is at 2.1 s.

On the stage each clip opens on its first frame, held through the frame check
and "Stand tall and still.", and plays on "Squat!", so the lifter squats on the
command. Its last frame is held for "Rack!". `tests/unit/samples.test.ts` and
`tests/judge/judge.spec.ts` check all three calls and the trim: she goes down within
1.5 s of "Squat!", and the clip ends within 1 s of "Rack!".

Licences: https://creativecommons.org/licenses/by/3.0/ and https://www.pexels.com/license/
