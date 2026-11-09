# The sample lifts

The clips "Watch a sample lift" plays on the Try a lift stage (plan 5.2, look 7),
and the demo meet's lifts (plan 5.36): the close call is only in the demo meet.
The good and no lifts are on YouTube under the Creative Commons Attribution licence
(CC BY 3.0, "reuse allowed"; read on each video's page Nov 7, 2026). The close call is
on Pexels under the Pexels licence (free to use, no attribution required; we credit it
anyway; read on the video's page Nov 9, 2026). No one in them endorses First Meet.

Our changes: each is trimmed to one lift, sound removed, and re-encoded as H.264. The
good and no lifts are scaled from 1920×1080 to 1280×720; the close call is upright,
720×1366, as downloaded. No crop, filter or grade.

| File | Kind | Source | Author | Licence | Cut from the source |
|---|---|---|---|---|---|
| `good-lift-wabba.mp4` | good lift | "Supported Squats", https://www.youtube.com/watch?v=4_MDTbRIO0I (July 5, 2018) | WABBA (@WabbaQualifications) | CC BY 3.0 | 20.8 s to 26.6 s |
| `no-lift-half-squat-motion.mp4` | no lift | "Mini Squats", https://www.youtube.com/watch?v=wqCvuhfRXRU (June 17, 2019) | Motion (@motion2067) | CC BY 3.0 | 13.9 s to 19.1 s |
| `close-call-pexels-8837221.mp4` | close call | "A Woman in Activewear Doing Squats at Home", https://www.pexels.com/video/a-woman-in-activewear-doing-squats-at-home-8837221/ | MART PRODUCTION | Pexels licence | 15.5 s to 20.0 s |

- **The good lift:** a woman in a plain studio with a wooden floor, side-on,
  holding a chair back for balance, squats with her hip crease below her knee
  and stands. The judge gives three white lights.
- **The no lift:** a woman in a white studio, side-on, holding a chair back,
  does a mini squat. The video was made to show the mini squat, so a red for
  depth is the fault it demonstrates (plan 5.2: a red only on a clip made to
  demonstrate that fault). The judge gives three red lights for depth.
- **The close call:** a woman in a bright living room, in a three-quarter view from
  her right, hands clasped at her chest, squats once with her hip crease right at her
  knee and stands. Found in 5.36's step 3 search (Pexels), Nov 9, 2026: the third
  rep of the source. The server's judge (the worker's points) measures her depth at
  -0.012, mid-way in the close band (within 0.10 of parallel, not 0.05 past it), so
  it gives a close call, never a red. "Squat!" is at 0.9 s, "Rack!" at 4.1 s, after
  she stands. It replaces the 8837118 cut (-0.073), which staging's judge read at
  -0.087 on one run and -0.121, a red, on another: the reading moves by a few
  hundredths between machines, so the close call has to sit well inside the band
  (`tests/worker/worker.test.ts` asks for 0.04). Any re-cut or re-encode is measured
  again on the worker.

In Try a lift, the good lift and the no lift open on their first frame, held
through the frame check and "Stand tall and still.", and play on "Squat!", so
the lifter squats on the command. The last frame is held for "Rack!". The close
call never plays there: only the demo meet's server judges it, with its stored
command times, so it skips the side-on frame check (its three-quarter view would
fail that check). `tests/unit/samples.test.ts` and `tests/judge/judge.spec.ts` check
the trim (she goes down within 1.5 s of "Squat!", and the clip ends within 1 s of
"Rack!"), the good and no lifts' calls, and that the server's judge calls the close
call close, or on the band's edge, on Chromium's points.
`tests/worker/worker.test.ts` checks each clip's call on the server's own points,
with its stored command times: that is the call the demo meet gives.

Licences: https://creativecommons.org/licenses/by/3.0/ and https://www.pexels.com/license/
