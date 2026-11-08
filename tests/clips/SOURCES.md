# The judge's test clips

Plan piece 1 (`judge-web`), as approved Nov 7 with items 47 and 48. Six videos
from Wikimedia Commons, the ones named in The Playner's pose test. Each one
keeps its own licence. The two trimmed clips are changed copies (cut, sound
removed) and stay under the licence of the original. They are test data only
and never shown in the product. The code's MIT licence doesn't cover them.

The calls each clip must get are in `expected.json`. "With the frame check
skipped" means the judge treats the spot as right from the first frame. Every
other rule still runs as written, the judged-frame visibility rule included.

| Test file | Commons file | Licence | By | Trim | Calls |
|---|---|---|---|---|---|
| `racked-squats-side.webm` | [Kettlebell Racked Squats (side view).webm](https://commons.wikimedia.org/wiki/File:Kettlebell_Racked_Squats_(side_view).webm) | CC BY-SA 4.0 | Taco fleur | 0.0 to 47.4 s of 50.9 s | frame check passes; 5 white |
| `goblet-squat.webm` | [Kettlebell Goblet Squat.webm](https://commons.wikimedia.org/wiki/File:Kettlebell_Goblet_Squat.webm) | CC BY-SA 4.0 | Taco fleur | none (0 to 23.1 s; it holds only its 2 squats) | frame check fails, "Turn so your side faces the phone."; skipped: 2 white |
| `half-squat.webm` | [Muscle Strengthening at Home - Half squat.webm](https://commons.wikimedia.org/wiki/File:Muscle_Strengthening_at_Home_-_Half_squat.webm) | Public domain | Centers for Disease Control and Prevention | 15.0 to 32.0 s of 78.6 s | frame check fails, "Turn so your side faces the phone."; skipped: 2 red `depth` |
| `half-squat-whole.webm` | the same video, whole | Public domain | Centers for Disease Control and Prevention | none | skipped: see the list below |
| `deadlift-demo.webm` | [Deadlift - exercise demonstration video.webm](https://commons.wikimedia.org/wiki/File:Deadlift_-_exercise_demonstration_video.webm) | CC BY 3.0 | FitnessScape | none (0 to 7.4 s; it holds only its 2 deadlifts) | frame check fails, "Turn so your side faces the phone." while she's at the bar; skipped: 2 lockouts |
| `squats-wikipedia-knee.webm` | [Squats Wikipedia.webm](https://commons.wikimedia.org/wiki/File:Squats_Wikipedia.webm) | CC BY-SA 3.0 | CRiles23 | none | frame check fails |
| `squat-from-behind.webm` | [Squat - exercise demonstration video.webm](https://commons.wikimedia.org/wiki/File:Squat_-_exercise_demonstration_video.webm) | CC BY 3.0 | FitnessScape | none | frame check fails, with the feet part and the side-on part both failing; the line is "Step back until we can see your feet." |

## Why the trims are where they are

- **Racked squats, 0.0 to 47.4 s.** It starts with the pick-up, so the test
  proves the pick-up isn't judged. The video has 6 squats after the
  pick-up. The first (about 4.4 to 6.8 s) comes before she has stood still,
  so "Squat!" hasn't been called yet and it isn't judged, as in a real
  attempt. "Squat!" comes at 7.9 s. The 5 squats after it are the 5 whites.
  The cut is at 47.4 s, after the 6th squat is stood up (46.7 s) and before
  she bends to put the bells down (from 47.5 s).
- **Half squat, 15.0 to 32.0 s.** The first two half squats filmed full
  body, the way a lifter would film. The shot changes to the full room at
  16.6 s; the trim starts 1.6 s earlier, on the end of the close-up of her
  standing legs. "Squat!" needs 1.5 s after "Good spot." and then 0.6 s
  standing still, and she starts to bend about 1.8 s into the full-room
  shot. A cut at 16.6 s left no time for "Squat!" before rep 1, so only rep
  2 was judged. Rep 1 starts at 20.3 s and rep 2 at 26.8 s (20.20 and 26.73 s in the
  whole video's poses; the cut copy is a fresh encode), and she stands
  still from 30.6 s. Rep 3 starts at 32.4 s, after the cut. Their depths,
  −0.82 and −0.70 of a thigh, match the pose test's −0.81 and −0.71.

## Which line the deadlift is read on

The plan has her at the bar during the frame check: "Bar is loaded." comes
after it, and the deadlift window's baseline is where her hip sits during
"Bar is loaded." So the deadlift's line is read on 0.07 to 1.87 s, while she
sets up at the bar, and the line there is "Turn so your side faces the
phone." When she stands tall with the bar (1.87 to 3.93 s, and from 5.60 s)
her feet drop out of sight, and the feet line shows instead, since feet come
first. Across the whole clip the feet line shows a little more often (53%
of frames, side-on 47%). The side-on part fails on every frame.

## The whole half squat video

Every call the judge makes on the whole 78.6 s video, with the frame check
skipped. "Starts" is the knee going under 140°. "Judged" is the frame the
call is about (the lowest point). There is no white.

| Starts | Judged | Call | What the frame shows, by eye |
|---|---|---|---|
| 6.00 s | 6.00 s | red `depth` | **Not a squat.** She's standing, filmed from the thighs up. Pinned so a change shows up; it doesn't prove the judge right. |
| 11.33 s | 11.40 s | close call `visibility` | A squat filmed from the waist up. The ankle is out of the picture (visibility 0.19). |
| 11.80 s | 13.47 s | red `depth` | Close-up of her legs, squat above parallel |
| 20.20 s | 21.47 s | red `depth` | Full body, half squat above parallel (in the trim) |
| 26.73 s | 27.60 s | red `depth` | The same (in the trim) |
| 33.20 s | 35.00 s | red `depth` | The same |
| 45.73 s | 46.53 s | red `depth` | The same |
| 57.80 s | 62.93 s | close call `visibility` | Close-up of her hips against a wall; the knees and feet are out of the picture |
| 70.00 s | 70.13 s | close call `visibility` | Standing, facing the camera; hip, knee and ankle visibility 0.03 to 0.10 |
| 70.73 s | 72.33 s | red `depth` | A wall sit, thighs above parallel |
| 76.60 s | 78.40 s | red `depth` | The frame is almost black. **Too dark to check by eye.** Pinned so a change shows up. |

Before the judged-frame visibility rule (3.4, item 48), 62.93 s and 70.13 s
were whites. Neither is a squat. That's what the rule was added for.

## How the poses are measured

`EXTRACT=1 npm run test:judge -- extract` runs MediaPipe Pose (tasks-vision
1.2.2, the same model the phone uses) in Chromium at 15 frames a second. It
writes the points to `poses/<clip>.json`, and the unit tests read those.
`CLIP=half-squat,racked-squats-side` measures only the clips named.
`tests/judge/judge.spec.ts` measures the poses fresh on every run, and the
calls must agree.
