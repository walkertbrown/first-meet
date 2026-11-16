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

**The bench's frames** (3.4d step 1; with no Press!, as ruled for item 107, The Playner, Nov 16):
- **With a Press!:** the touch is the wrists' lowest point between Start! and Press!, and the
  lockout their top after Press!.
- **With no Press!** (the bar never stopped, so the phone never called it):
  - the touch is the wrists' lowest point between Start! and Rack! (or the end);
  - the lockout is their top after the touch;
  - the poses are looked for all the way to Rack!.
- **Either way:** every frame from 0.4 s before to 0.4 s after each, within the 60 cap.
- **No usable poses:**
  - with a Press!, every frame from 1 s before it to 0.5 s after;
  - with none, every frame 0.4 s either side of the saved bar path's lowest point between Start!
    and Rack! (`bar_low_ms`, which the frames job reads from `attempts.barKey`);
  - with no bar path either, every frame from Start! + 0.5 s for 1.5 s;
  - each time, plus every frame from 0.6 s before Rack!.

**Frames per bench**, as `recut.py` cuts them:

| bench attempts | attempts | frames (min, median, max) |
|---|---|---|
| with a Press!, cut 1 | 19 | 22, 35, 57 |
| lost track (Press! late) | 22 | 19, 38.5, 56 |
| no Press! (gym reds, cut 1) | 21 | 15, 23, 30 (5, 7, 9 before the no-Press! rule) |

The shortest are IKuX reps 2 and 3, at 15. Their reps last 1.6 s, so the windows overlap.

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
