# Bench commands test (plan 3.4b, item 74)

This test runs the phone's bench caller ("Start!", "Press!", "Rack!") on each rep's plate trace, frame by frame, using past
frames only. It scores the commands against the by-eye times. Everything here runs from committed numbers. **No clip, grey
frame or picture is committed** (the clips are YouTube standard licence, test only).

## Re-run it

```
npx tsx tests/bench-commands/score.ts                  # every rep and the six lines
python3 -I tests/bench-commands/eye.py /tmp/eye.json   # the by-eye times, from the reference traces (needs numpy)
```

Env: `QUIET=1` prints the lines only. `DEBUG=<id prefix>` prints every frame of that rep. `OUT=<file>` writes the
settings, the lines and every rep's times as JSON (`results/commands.json`). A first argument overrides settings from a
JSON file, and a second points at another traces folder. `tests/unit/bench-commands.test.ts` runs on every commit. It
checks that the scoring gives `results/commands.json`, that every line passes, and that no command changes when the
frames after it are cut off (no look-ahead).

## Files

| File | What it is |
| --- | --- |
| `caller.ts` | `BenchCaller`: the caller under test, with its settings in `RULES`. The header comment gives every rule. |
| `plate-tracker.ts` | Item 70's plate tracker, unchanged. |
| `track.ts` | How the traces were made from the grey frames. It reproduces `data/traces` exactly, but needs the frames, which are not committed. There's no whole-frame search (3.4b, choice (b)). |
| `score.ts` | The scoring: the six lines below. |
| `eye.py` | The by-eye times (`data/eyetimes.json`), from the by-eye calls and the reference traces. It reproduces the committed file exactly. |
| `data/traces/` | The phone tracker's plate trace for each rep. |
| `data/reference/` | A separate CSRT tracker's bar height for each rep (`t` s, `y` fraction of the frame, top = 0). Used only for the eye times. |
| `data/calls-meet.json`, `data/calls-run1.json` | The by-eye calls: the Start! window and each rep's bottom start and pause end, in seconds of the clip. |
| `data/marks-*.json` | Where and when the plate was tapped. |
| `results/commands.json` | The scorer's output: settings, the six lines and every rep's times. |

**Trace format:** `{ id, w, h, racked, mark, pts }`, with `pts` a list of `[t ms, x, y, score]`. x and y are fractions
of the 284×160 frame, and `score` is the template match (−1 to 1).

## How it is scored

These are the 22 reps from item 70: 9 meet reps and 13 run-1 reps. Four of the run-1 reps bounce (m-k8, Nv9h, VM_y, xXFj).
Lines 1, 2 and 5 cover the 18 paused reps. Lines 3 and 4 cover all 22.

The lifters followed a real referee, not this phone. So if the phone hasn't called Start! by the eye's descent (less 0.1 s),
or Press! by the moment she rose, the clip is held there. The last 0.4 s plays back and forth until the command comes, plus
0.3 s to react. She waits at most 3 s for Press!. For Start!, she waits until it comes or the phone voids the attempt, at
most 6 s. Every later time, by eye and by phone, moves by the wait.

1. No Press! while the bar is still going down: no more than 1% of the frame lower after Press! (3-frame median).
2. Press! within 1 s of the stop on at least 90% of reps, and none past 1.5 s unless it was a late Press!.
3. No Start! before the bar settled. A rep with no Start! passes only if the attempt is voided: Rack! within 5 s of leaving
   the hooks, or when the track is lost off the hooks.
4. No Rack! before the bar is back up. A rep with no Start! passes only by the void's Rack!.
5. "Back up" (Press! and Rack! both came, and not the no-rep Rack! or a void) agrees with the eye.
6. No scored rep is voided.

## Results

All six lines pass (`results/commands.json`):

1. No bar sinks more than 0.8% of the frame after Press! (IKuX). 8qzW sinks 0.7%.
2. Press! comes 0.54–0.97 s after the stop on all 18 reps.
3. and 4. No early Start! or Rack! on any of the 22 reps. m-k8, Nv9h and VM_y get no Start!, and each is voided:
   - m-k8: off the hooks at 1.07 s, lost (stuck) at 1.50 s, void at 1.50 s.
   - VM_y: off the hooks at 2.90 s, lost at 5.30 s, void at 5.30 s.
   - Nv9h: off the hooks at 9.57 s, void 5 s later at 14.57 s.
5. "Back up" agrees on 18 of 18.
6. No scored rep is voided.

The settings fit these reps, not every bench. The "off the hooks" distance (3% of the frame) has about half a pixel of
margin: at 2.5%, VM_y's Start! is early, and at 3.5%, ak3m2 and ak3m3 fail. Press! "still" at 0.4 s instead of 0.5 s
lets 8qzW or IKuX sink past 1%.

The run before this one, with the whole-frame search, is at commit df0c886. There, line 5 failed on IA0P: the search
jumped to a medicine ball.
