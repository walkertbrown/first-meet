# Bench commands test (plan 3.4b, item 74)

This test runs the phone's bench caller ("Start!", "Press!", "Rack!") on each rep's plate trace, frame by frame, using past
frames only. It scores the commands against the by-eye times. Everything here runs from committed numbers. **No clip, grey
frame or picture is committed** (the clips are YouTube standard licence, test only).

## Re-run it

```
npx tsx tests/bench-commands/score.ts         # every rep, the six lines and the note on still pauses
python3 -I tests/bench-commands/eye.py /tmp/eye.json   # the by-eye times, from the reference traces (plain Python)
```

Env: `QUIET=1` prints the lines only. `DEBUG=<id prefix>` prints every frame of that rep. `OUT=<file>` writes the
settings, the lines, the note and every rep's times as JSON (`results/commands.json`). `STILL_START=1` also makes the
Start! hold a still stretch (see Results). A first argument overrides settings from a JSON file, and a second points at
another traces folder. `tests/unit/bench-commands.test.ts` runs on every commit. It checks that the scoring gives
`results/commands.json`, that line 1 isn't failed, that lines 2 to 6 pass, and that no command changes when the frames
after it are cut off (no look-ahead).

## Files

| File | What it is |
| --- | --- |
| `caller.ts` | `BenchCaller`: the caller under test, with its settings in `RULES`. It is the phone's and the server's own caller, `web/lib/judge/bar-caller.ts` (settings in `shared/rules.json` `benchBar`), re-exported. Its header comment gives every rule. |
| `plate-tracker.ts` | Item 70's plate tracker, unchanged, re-exported from `web/lib/judge/plate-tracker.ts`. |
| `track.ts` | How the traces were made from the grey frames. It reproduces `data/traces` exactly, but needs the frames, which are not committed. There's no whole-frame search (3.4b, choice (b)). |
| `score.ts` | The scoring: the six lines below. |
| `eye.py` | The by-eye times (`data/eyetimes.json`), from the by-eye calls and the reference traces. Plain Python, no packages. It reproduces the committed file byte for byte. |
| `data/traces/` | The phone tracker's plate trace for each rep. |
| `data/reference/` | A separate CSRT tracker's bar height for each rep: `t` in s, `y` with top = 0, and `h` the frame height in the units of `y` (1 for the meet reps, which are fractions; the source frame's px for run 1). `y / h` is the fraction of the frame. Used for the eye times, the still stretches and line 1's second trace. |
| `data/calls-meet.json`, `data/calls-run1.json` | The by-eye calls: the Start! window and each rep's bottom start and pause end, in seconds of the clip. |
| `data/marks-*.json` | Where and when the plate was tapped. |
| `results/commands.json` | The scorer's output: settings, the six lines (each with a status), the note on still pauses and every rep's times. |

**Trace format:** `{ id, w, h, racked, mark, pts }`, with `pts` a list of `[t ms, x, y, score]`. x and y are fractions
of the 284×160 frame, and `score` is the template match (−1 to 1).

## How it is scored

These are the 22 reps from item 70: 9 meet reps and 13 run-1 reps. Four of the run-1 reps bounce (m-k8, Nv9h, VM_y, xXFj).
Lines 1, 2, 5 and 6 cover the 18 paused reps. Lines 3 and 4 cover all 22.

**The replay.** The lifters followed a real referee, not this phone. So if the phone hasn't called Start! by the eye's
descent (less 0.1 s), or Press! by the moment she rose, she holds the bar and the clip is held:

- For Press!, the clip stops at the end of the latest 0.4 s of her pause where the reference bar stays within 1% of the
  frame. That stretch plays back and forth until Press! comes, plus 0.3 s to react, at most 3 s. If her pause has no
  such stretch, the last 0.4 s of it (or all of it, if it's shorter) is played instead, and the rep is named.
- For Start!, the last 0.4 s before the descent is played, until Start! comes or the phone voids the attempt, at most 6 s.
- Every later time, by eye and by phone, moves by the wait. Each rep says whether Start! and Press! came in the clip or
  in the replay (`startIn`, `pressIn`).

**The lines:**

1. No Press! while the bar is still going down: no more than 1% of the frame lower after Press! (3-frame median). Scored
   only on the reps where Press! came in the clip itself, on the phone's trace and on the reference trace. A replayed
   pause isn't the lifter's real pause, so replayed reps are listed but not scored. If fewer than half of the 18 get
   Press! in the clip, line 1 is "not shown on clips". That is not a fail; a sink on an in-clip rep is.
2. Press! within 1 s of the stop on at least 90% of reps, and none past 1.5 s unless it was a late Press!.
3. No Start! before the bar settled. A rep with no Start! passes only if the attempt is voided: Rack! within 5 s of
   leaving the hooks (timed from leaving the hooks), or when the track is lost off the hooks.
4. No Rack! before the bar is back up. A rep with no Start! passes only by the void's Rack!.
5. "Back up" (Press! and Rack! both came, and not the no-rep Rack! or a void) agrees with the eye.
6. No scored rep is voided.

## Results

Lines 2 to 6 pass. Line 1 is **not shown on clips** (`results/commands.json`):

1. Press! came in the clip on only 4 of 18 reps: cE2t, KrDo, Nazt and uGCh. On those 4, neither trace sinks after Press!
   (largest: 0.1% on the phone's trace, 0.0% on the reference). On the other 14 it came in the replay, later than the
   lifter really rose. In the replay, IKuX's phone trace sinks 1.2%, on a pause with no still stretch. So the clips
   don't show line 1 either way; `/ops` "Press! while sinking" on real attempts is the real check.
2. Press! comes 0.54–1.00 s after the stop on all 18 reps. The margin is under a frame: AMih at 0.999 s and hIuj at
   0.97 s, at about 30 frames a second. If AMih went over, 17 of 18 (94%) would still pass the 90% line.
3. and 4. No early Start! or Rack! on any of the 22 reps. m-k8, Nv9h and VM_y get no Start!, and each is voided:
   - m-k8: lost (stuck) 0.43 s after leaving the hooks, void then.
   - VM_y: lost 2.40 s after leaving the hooks, void then.
   - Nv9h: void 5.00 s after leaving the hooks.
5. "Back up" agrees on 18 of 18.
6. No scored rep is voided.

**Clip or replay, rep by rep** (Start! / Press!):

| Clip or replay | Reps |
| --- | --- |
| clip / clip | cE2t, KrDo |
| replay / clip | Nazt, uGCh |
| clip / replay | 83WA, 8qzW, AMih, Ecs1, Ecs2, NFjK, xXFj, z838 |
| replay / replay | 6K8v, ak3m2, ak3m3, hIuj, IA0P, IKuX, Lj0X |
| no Start! (void) | m-k8, Nv9h, VM_y |

**Pauses with no still stretch** (the reference bar moves more than 1% of the frame in every 0.4 s of the pause, or the
pause is shorter than 0.4 s): 6K8v, 8qzW, IKuX, NFjK and xXFj.

**The Start! hold.** Only the Press! hold has to be still. With `STILL_START=1` the Start! hold is also the latest
still 0.4 s, and 6K8v gets no Start!: it voids 5.03 s after leaving the hooks, so lines 5 and 6 fail. In that clip she
holds the bar for 1.8 s before going down, and the reference says it's still in height, but it wanders sideways about 3%
of the frame's width, and the phone needs it still both ways. The reference has height only, so it can't say how still
it was sideways.

The settings fit these reps, not every bench. The "off the hooks" distance (3% of the frame) has about half a pixel of
margin: at 2.5%, m-k8's and VM_y's Start! are early, and at 3.5%, ak3m2 and ak3m3 fail. With Press! "still" at 0.4 s
instead of 0.5 s, Press! comes in the clip on 7 of 18 reps (83WA, Ecs1 and z838 join), none sinks past 1% (largest 0.9%
on the phone's trace, 0.1% on the reference), and line 1 is still not shown. The plan's 0.5 s is kept.

The run before this one, with the whole-frame search, is at commit df0c886. There, line 5 failed on IA0P: the search
jumped to a medicine ball.
