# The sample lifts

The clips "Watch a sample lift" plays on the Try a lift stage (plan 5.2, look 7),
and the demo meet's lifts (plan 5.36): the close call is only in the demo meet.
All three are on YouTube under the Creative Commons Attribution licence (CC BY 3.0,
"reuse allowed"; read on each video's page, the good and no lifts Nov 7, 2026, the
close call Nov 9, 2026). No one in them endorses First Meet.

Our changes: each is trimmed to one lift, sound removed, and re-encoded as H.264. The
good and no lifts are scaled from 1920×1080 to 1280×720; the close call is 1280×720 as
downloaded, at the source's own 23.976 frames a second (no frames repeated). No crop,
filter or grade.

| File | Kind | Source | Author | Licence | Cut from the source |
|---|---|---|---|---|---|
| `good-lift-wabba.mp4` | good lift | "Supported Squats", https://www.youtube.com/watch?v=4_MDTbRIO0I (July 5, 2018) | WABBA (@WabbaQualifications) | CC BY 3.0 | 20.8 s to 26.6 s |
| `no-lift-half-squat-motion.mp4` | no lift | "Mini Squats", https://www.youtube.com/watch?v=wqCvuhfRXRU (June 17, 2019) | Motion (@motion2067) | CC BY 3.0 | 13.9 s to 19.1 s |
| `close-call-box-squat-king-18s.mp4` | close call | "Body Weight Box Squat", https://www.youtube.com/watch?v=tvu_4C-bDqU (Jan 20, 2020) | Amanda King (@amandak_bestie) | CC BY 3.0 | 18.7 s to 21.3 s |

- **The good lift:** a woman in a plain studio with a wooden floor, side-on,
  holding a chair back for balance, squats with her hip crease below her knee
  and stands. The judge gives three white lights.
- **The no lift:** a woman in a white studio, side-on, holding a chair back,
  does a mini squat. The video was made to show the mini squat, so a red for
  depth is the fault it demonstrates (plan 5.2: a red only on a clip made to
  demonstrate that fault). The judge gives three red lights for depth.
- **The close call:** a woman in a daylit gym, side-on from her left, hands clasped
  at her chest, squats once to a box with her hip crease right at her knee and
  stands. A few people train in the background. Found in 5.36's step 3 search
  (YouTube's Creative Commons filter), Nov 9, 2026: one rep of the source's run of
  back-to-back reps. The server's judge (the worker's points) measures her depth at
  -0.054 on her near (left) side, and 0.002 on the far side, both for her depth
  (`borderline_depth`, with no frame too hard to see), so it is a close call
  well inside the band (within 0.10 of parallel, not 0.05 past it) whichever side the
  judge takes: never a red or a white. "Squat!" is at 0.3 s, "Rack!" at 2.05 s, after
  she stands.

  It replaces the Pexels 8837221 cut (-0.012 on its near side), a three-quarter view
  whose two sides were nearly tied for visibility: judged from the other side it read
  0.055, a white. Before that, the Pexels 8837118 cut (-0.073) read -0.087 on one
  staging run and -0.121, a red, on another. The reading moves by a few hundredths
  between machines, so the close call has to sit well inside the band, on both sides
  (`tests/worker/worker.test.ts` asks for 0.04). Any re-cut or re-encode is measured
  again on the worker.

In Try a lift, the good lift and the no lift open on their first frame, held
through the frame check and "Stand tall and still.", and play on "Squat!", so
the lifter squats on the command. The last frame is held for "Rack!". The close
call never plays there: only the demo meet's server judges it, with its stored
command times. `tests/unit/samples.test.ts` and `tests/judge/judge.spec.ts` check
the trim (she goes down within 1.5 s of "Squat!", and the clip ends within 1 s of
"Rack!"), the good and no lifts' calls, and that the server's judge calls the close
call close, or on the band's edge, on Chromium's points.
`tests/worker/worker.test.ts` checks each clip's call on the server's own points,
with its stored command times: that is the call the demo meet gives.

Licence: https://creativecommons.org/licenses/by/3.0/
