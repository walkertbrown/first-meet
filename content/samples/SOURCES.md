# The sample lifts

The clips "Watch a sample lift" plays on the Try a lift stage (plan 5.2, look 7),
and the demo meet's lifts (plan 5.36): the close call is only in the demo meet.
The good and no lifts are on YouTube under the Creative Commons Attribution licence
(CC BY 3.0, "reuse allowed"; read on each video's page Nov 7, 2026). The close call is
on Pexels under the Pexels licence (free to use, no attribution required; we credit it
anyway; read on the video's page Nov 9, 2026). No one in them endorses First Meet.

Our changes: each is trimmed to one lift, sound removed, and re-encoded as H.264. The
good and no lifts are scaled from 1920×1080 to 1280×720; the close call from 1366×720
to 1280×674 (its own shape, 1.9:1, kept). No crop, filter or grade.

| File | Kind | Source | Author | Licence | Cut from the source |
|---|---|---|---|---|---|
| `good-lift-wabba.mp4` | good lift | "Supported Squats", https://www.youtube.com/watch?v=4_MDTbRIO0I (July 5, 2018) | WABBA (@WabbaQualifications) | CC BY 3.0 | 20.8 s to 26.6 s |
| `no-lift-half-squat-motion.mp4` | no lift | "Mini Squats", https://www.youtube.com/watch?v=wqCvuhfRXRU (June 17, 2019) | Motion (@motion2067) | CC BY 3.0 | 13.9 s to 19.1 s |
| `close-call-pexels.mp4` | close call | "A Woman Doing Squats", https://www.pexels.com/video/a-woman-doing-squats-8837118/ (July 20, 2021) | MART PRODUCTION | Pexels licence | 7.0 s to 13.2 s |

- **The good lift:** a woman in a plain studio with a wooden floor, side-on,
  holding a chair back for balance, squats with her hip crease below her knee
  and stands. The judge gives three white lights.
- **The no lift:** a woman in a white studio, side-on, holding a chair back,
  does a mini squat. The video was made to show the mini squat, so a red for
  depth is the fault it demonstrates (plan 5.2: a red only on a clip made to
  demonstrate that fault). The judge gives three red lights for depth.
- **The close call:** a woman in a bright living room, side-on, hands clasped at
  her chest, squats once with her hip crease right at her knee and stands. Found
  in 5.36's step 3 search (Pexels), Nov 9, 2026. The server's judge (the worker's
  points) measures her depth at -0.073, inside the close band (within 0.10 of
  parallel, not 0.05 past it), so it gives a close call for depth
  (`borderline_depth`), never a red. "Squat!" is at 0.9 s, "Rack!" at 5.7 s, after
  she stands. Chromium's points read -0.101, on the band's edge: the clip is only
  ever judged by the server (the demo meet; Try a lift never plays it). The reading
  moves with the cut (7.4–13.0 s read -0.098), so this exact file is the one measured;
  any re-cut or re-encode is measured again on the worker.

On the stage each clip opens on its first frame, held through the frame check
and "Stand tall and still.", and plays on "Squat!", so the lifter squats on the
command. Its last frame is held for "Rack!". `tests/unit/samples.test.ts` and
`tests/judge/judge.spec.ts` check the trim (she goes down within 1.5 s of "Squat!",
and the clip ends within 1 s of "Rack!"), the good and no lifts' calls, and that the
close call is close or on the band's edge on Chromium's points.
`tests/worker/worker.test.ts` checks each clip's call on the server's own points,
with its stored command times: that is the call the demo meet gives.

Licences: https://creativecommons.org/licenses/by/3.0/ and https://www.pexels.com/license/
