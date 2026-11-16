# The referee bot test

Plan 3.4d step 11 (item 88's done-when, item 107's set). Before the referee bot gives real lights,
it is run on every clip the team has by-eye calls for, asked exactly as the product asks, and
scored against those calls.

| file | what it is |
|---|---|
| `build-set.ts` | builds `calls.json` and `holdout.json` from the by-eye times (`data/`, `../bench-commands/data/`) and the worker's poses, through the product's own code |
| `calls.json` | the answer key: every attempt, cut as the phone would send it, with its by-eye call. Never changes after the first run; every run records its SHA-256 |
| `holdout.json` | the held-back third, by clip, chosen by a seeded shuffle before any run |
| `recut.py` | cuts each attempt's frames from its clip with the worker's own `make_frames`, and writes `frames.json` with each JPEG's SHA-256 |
| `run.ts` | asks the three lamps for each attempt with the product's `attemptWords`, `buildPrefix` and `askLamps` |
| `score.py` | recounts every line from the committed answers alone: no key, no frames, no product code |
| `results/` | each run's answers, tokens, costs and times |

## How each attempt is made

Every number the bot is sent comes from the code that would send it in the product:

- **Bench (Barbell):**
  - the commands are put where the plan's rules put them on the eye's times;
  - `takeBar`'s own `checkCommandTimes` runs on them, then `measureBar` on the plate's path, which
    gives the pause, sinking and lost-bar measures;
  - two cuts:
    - **cut 1:** Press! as the phone calls it;
    - **lost track:** the phone loses the bar, and calls Press! 2 s after the descent, with
      `press_late_why: lost`.
- **Squat, deadlift and the Home press sets:**
  - the phone's own `MeetLift` calls the commands from the worker's poses;
  - `judgeAttempt` makes the lights, the moments and any close-call reason;
  - the moments are taken the way the frames job takes them.
- **Reasons:**
  - a close call keeps the judge's reason (`visibility`, `command_times` and so on);
  - a bench is `bench_referee`;
  - every other attempt is sent `judge_unavailable`, the reason a staging spot check gives.

## The set

| group | attempts | sure red | sure white | either | weight |
|---|---|---|---|---|---|
| bench white (cut 1) | 15 | 0 | 14 | 1 | meet 100 kg; ak3m2 175, ak3m3 182.5 kg; gym 60 kg |
| bench white (lost track) | 13 | 0 | 13 | 0 | as above |
| bench red (cut 1) | 22 | 22 | 0 | 0 | gym 60 kg; Nazt 100 kg |
| bench red (lost track) | 9 | 9 | 0 | 0 | as above |
| close calls | 4 | 0 | 0 | 4 | bench demo 60 kg; box squat 100 kg |
| press (Home sets) | 21 | 4 | 12 | 5 | 20 kg |
| squat and deadlift | 11 | 6 | 5 | 0 | kettlebells 12 and 16 kg; barbell 60 and 100 kg |

**Weights.** The bot is told a weight on every attempt. Each clip's weight is the same for every
attempt in it.

| from where | clips | weight |
|---|---|---|
| read off the clip | ak3m2, ak3m3 (meet bench) | 175 and 182.5 kg |
| stand-in | the other meet benches | 100 kg |
| stand-in | gym bench sets, the bench demo | 60 kg |
| stand-in | press sets | 20 kg |
| stand-in | racked squats, goblet squat (kettlebells) | 12 and 16 kg |
| stand-in | half squat | 60 kg |
| stand-in | deadlift demo, the three samples | 100 kg |

**Commands on the bench**, as ruled for item 107 (The Playner, Nov 15, 11:41 PM):
- **Press!:** 0.2 s before the eye's pause end, and never before the bar stops. By the eye's
  pause end the bar has started up, so the phone would measure no pause. This applies in cut 1;
  the lost-track cut keeps its own late Press!.
- **Rack!:** where the rules put it past the cut's end, it goes one server frame (67 ms) inside
  the cut, in both cuts. Every command is then inside its clip, as in a meet, where the phone
  films 1.5 s past Rack!. The frame's margin means a recut a frame short can't round it outside
  (NerdCider, 11:42 PM).
- **The builder's check:** `build-set.ts` stops if any bench would go out with reason
  `command_times`, so every bench gets its usual lines.

**The bench's frames** (3.4d step 1, "the bar path first", The Playner, Nov 16). The frames job
sends the saved bar path (`attempts.barKey`) on every bench; `worker/bench_path.py` picks the way in:
- **The bar path:**
  - the window runs from Start! to Press! + 3 s, or to Rack! (or the end) with no Press!;
  - the touch is the path's lowest point from Start! to Press! (or Rack!, or the end), and the
    lockout its top after the touch, within the window;
  - it's usable when it isn't lost before Press! (or Rack!) and has a point on at least 80% of the
    frames from Start! to the touch. A point counts at confidence 0.5 or more.
- **Lost partway** (before Press!, or Rack!): the path's points before the loss and the wrists'
  after it. A path lost after Press! keeps its touch; the lockout uses the wrists after the loss.
- **Else the wrists:** when seen on at least half the frames from Start! to Press! (or Rack!).
- **Either way:** every frame from 0.4 s before to 0.4 s after the touch and the lockout, and with
  a Press!, from the touch to 0.3 s after Press!, within the 60 cap.
- **Else a fixed window:** with a Press!, every frame from 1 s before it to 0.5 s after; without
  one, from Start! + 0.5 s for 1.5 s; either way, plus every frame from 0.6 s before Rack!.
- **The readings,** now in the plan's 3.4d step 1 word for word:
  - the path is "lost" when it has no point that counts for its last 0.5 s or more before the
    window's end;
  - "usable" means it isn't lost before Press! (or Rack!, or the window's end);
  - lost partway needs 80% cover from Start! to the loss, and the wrists seen on half the frames
    after it;
  - the wrists are smoothed by a 3-point median, as `measureBar` smooths the path;
  - the poses run only when the path isn't usable.
- **The lost-track cut** sends the whole saved path: the product saves the server's own track
  (`takeBar` re-tracks from the plate tap on the server's frames), and the phone losing the bar
  doesn't cut it short. `measureBar` and the drawn lines still stop where the phone lost it.

**The frames against the reference** (`test_touch.py`, in CI once `calls.json` and
`frames/frames.json` are committed): on every bench with a reference track (CSRT, not our
tracker), the frames sent must hold every frame within 0.2 s of the reference's lowest point from
Start! to Press! (or Rack!). It checks what the bot sees, not where the frames job put its touch.
It passes on every bench. On the frames cut before the bar-path rule it fails on 15 benches.

The table below isn't checked; it shows how far each touch is from the reference. Every cut-1
path here is whole, so it is no proof of the 80% rule; the worker tests thin a real trace for
that. Each bench's way in and its touch minus the reference's lowest point (negative: earlier). A lost-track cut always has its own late Press!; — is a bench with no lost-track cut
(see "Left out").

| bench | Press! | cut 1: way, ms from the reference | lost track: way, ms |
|---|---|---|---|
| AMih | yes | path, -100 | — |
| ak3m2 | yes | path, -67 | — |
| ak3m3 | yes | path, +133 | path, +133 |
| cE2t | yes | path, +167 | path, +167 |
| Ecs1 | yes | path, +33 | path, +67 |
| Ecs2 | yes | path, -33 | path, +33 |
| KrDo | yes | path, -100 | path, 0 |
| Lj0X | yes | path, 0 | path, 0 |
| Nazt | yes | path, -33 | path, -267 |
| uGCh | yes | path, +167 | path, +167 |
| 6K8v-r2 | no | path, -34 | — |
| 6K8v-r3 | no | wrists, +67 | path, 0 |
| 83WA-r1 | yes | path, +67 | path, +67 |
| 83WA-r2 | yes | path, +66 | path, +66 |
| 8qzW-r1 | yes | path, -33 | path, -33 |
| hIuj-r1 | yes | path, +67 | path, +67 |
| IA0P-r2 | yes | path, -934 **(the phone's trace froze)** | path, -934 **(the phone's trace froze)** |
| IKuX-r2 | no | path, 0 | — |
| IKuX-r3 | no | path, +67 | — |
| IKuX-r4 | no | path, 0 | — |
| IKuX-r5 | no | path, 0 | path, 0 |
| m-k8-r1 | no | path, -33 | path, -33 |
| NFjK-r3 | no | path, -33 | path, -33 |
| Nv9h-r1 | no | path, +200 | path, +200 |
| Nv9h-r2 | no | path, -33 | — |
| Nv9h-r3 | no | path, 0 | — |
| Nv9h-r4 | no | path, 0 | — |
| Nv9h-r5 | no | path, 0 | path, 0 |
| VM_y-r1 | no | path, +33 | — |
| VM_y-r2 | no | path, +33 | — |
| VM_y-r3 | no | path, 0 | — |
| VM_y-r4 | no | path, 0 | path, 0 |
| xXFj-r1 | no | path, -33 | path, -33 |
| xXFj-r2 | no | path, -133 | — |
| xXFj-r3 | no | path, 0 | — |
| xXFj-r4 | no | path, 0 | — |
| z838-r1 | yes | path, +34 | path, -34 |
| bench-demo-r1 | yes | wrists, no reference | — |
| bench-demo-r2 | yes | wrists, no reference | — |
| bench-demo-r3 | yes | wrists, no reference | — |

**More than 0.4 s off:**
- **IA0P rep 2, both cuts (934 ms early):** the phone's plate trace froze for 1.5 s (x and y still
  to 0.002, confidence 0.85 or more) and rose 0.4–0.5 s late, with a sideways jump. The reference
  keeps sinking through it. Don't tune toward the stuck track. Its frames still hold every frame
  within 0.2 s of the reference's touch, since the bench gets every frame from the touch to 0.3 s
  after Press!.

**6K8v rep 3, cut 1, takes the wrists** only because the committed trace ends at 11.2 s of the
clip, before the cut does (12.77 s). It isn't a tracker loss. In the product the server's path
would go on, and this bench would take the path.

**These paths are the phone's** (`data/traces`). In a meet the Pause line and the saved path come
from the server's re-track (`worker/plate.py`, the same tracking code on the server's 15 fps
frames), which drifts apart from the phone's on the same clip. On these 22 clips it sticks on
IA0P reps 1 and 3 (not rep 2), and on z838 for 14 s at confidence 0.55. The Playner rules on a
guard before any paid run.

**Frames per bench**, as `recut.py` cuts them:

| bench attempts | attempts | frames (min, median, max) |
|---|---|---|
| with a Press!, cut 1 | 19 | 22, 32, 43 |
| lost track (Press! late) | 22 | 28, 36.5, 47 |
| no Press! (gym reds, cut 1) | 21 | 20, 27, 30 (5, 7, 9 before the no-Press! rule) |

The shortest are IKuX rep 2 and VM_y rep 2, at 20. Their reps last 1.6 s, so the windows overlap. No other
attempt's frames changed with the bar-path rule.

**Held back:** 15 clips, 27 attempts (seed 1: a third of each group's clips, rounded up, with at
least 2 sure reds).

**Left out:**
- **AMih, lost track:** with Press! + 3 s, her lockout would fall after the cut.
- **13 gym reps, lost track:** their Press! would fall within 0.3 s of the next rep's descent, or
  after it. These are 6K8v rep 2, IKuX reps 2–4, Nv9h reps 2–4, VM_y reps 1–3 and xXFj reps 2–4.
- **The half squat at 11.8 s:** the camera moves through it, and the phone never says Squat!
  before it.

**Clips that can't be committed** (5.2's rule) aren't in the repo. `recut.py` makes the same frames
from each clip, and `frames.json`'s hashes check them. The JPEGs of the clips that are free to
reuse are committed in `frames/`: the bench demo, the squat and deadlift clips and the three
samples.

## Running it

```sh
# 1. the set (the poses come from worker/cli.py --fps 15 --one, one JSON per clip)
TSX_TSCONFIG_PATH=web/tsconfig.json npx tsx tests/referee-bot/build-set.ts --poses POSES --out tests/referee-bot

# 2. the frames (MediaPipe needs a CPU list in /sys; in a sandbox without one, bind a stand-in)
python3 tests/referee-bot/recut.py tests/referee-bot/calls.json --clips CLIPS --out FRAMES

# 3. a dry run: staging test answers, no key, no cost
TSX_TSCONFIG_PATH=web/tsconfig.json npx tsx tests/referee-bot/run.ts --set tests/referee-bot/calls.json \
  --frames FRAMES --out /tmp/dry.json --test red_white_white

# 4. run 1 (the two thirds), then the final runs (--all, the whole set, the second over 5 minutes later)
ANTHROPIC_API_KEY=... TSX_TSCONFIG_PATH=web/tsconfig.json npx tsx tests/referee-bot/run.ts \
  --set tests/referee-bot/calls.json --frames FRAMES --out tests/referee-bot/results/run-1.json

# 5. the score, from the committed files alone
python3 tests/referee-bot/score.py --set tests/referee-bot/calls.json tests/referee-bot/results/run-1.json
python3 tests/referee-bot/score.py --set tests/referee-bot/calls.json --pauses results/final-1.json results/final-2.json
```

`CLIPS` holds `meet/<clip>.mp4`, `bench/<id>.webm` and `press/<id>.webm`, the paths in `calls.json`.

## The lines (step 11)

Scored against the by-eye calls, where "either" agrees with anything. A failed attempt (no three
lamps) agrees with nothing, and its lamps count as not sure.

- **No wrong light on a sure call:** 1 allowed in the whole set, none among the held-back attempts.
- **It catches the reds:**
  - a majority red on 80% of the sure reds (rounded up);
  - a majority red on at least 3 sure bench reds. Among the held back, it's 3 or all of them if
    fewer;
  - a majority red on 80% of the sure bench reds with a Press! (Nazt and the lost-track reds);
  - no majority red on a lost-track white, beyond the 1 wrong light allowed.
- **Agreement:** at least 85% of attempts agree.
- **Sure:** at least 80% of lamps are `sure`.
- **Time:** the median time from frames ready to three lamps is under 2 minutes.
- **The cache:**
  - the left lamp writes the cache;
  - the head and right lamps read it, and never write the frames again.
- **Cost:** the cost written matches the tokens at step 10's prices ($4 in, $20 out, $5 cache
  write, $0.20 cache read, all a million tokens).
- **The lost bar:** a lost-track bench is never sent a pause figure or the sinking line.

The final runs pass every line on both runs, and on the held-back attempts alone too. `score.py`
also counts the lamps that differ between the two runs.
