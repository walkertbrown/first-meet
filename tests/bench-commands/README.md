# Bench commands test (plan 3.4b, item 74)

This test runs the phone's bench caller ("Start!", "Press!", "Rack!") on each rep's plate trace, frame by frame, using past
frames only. It scores the commands against the by-eye times. Everything here runs from committed numbers. **No clip, grey
frame or picture is committed** (the clips are YouTube standard licence, test only).

## Re-run it

```
npx tsx tests/bench-commands/score.ts                                   # with the whole-frame search (data/traces)
npx tsx tests/bench-commands/score.ts '' tests/bench-commands/data/traces-no-search
npx tsx tests/bench-commands/score.ts tests/bench-commands/results/stuck-0.3s.override.json tests/bench-commands/data/traces-no-search
python3 -I tests/bench-commands/eye.py /tmp/eye.json                     # the by-eye times, from the reference traces (needs numpy)
```

Env: `QUIET=1` prints the lines only. `DEBUG=<id prefix>` prints every frame of that rep. `OUT=<file>` writes every rep's
times as JSON. `npx vitest run tests/unit/bench-commands.test.ts` checks two things: the scoring still gives the committed
results, and no command changes when the frames after it are cut off (no look-ahead).

## Files

| File | What it is |
| --- | --- |
| `caller.ts` | `BenchCaller`: the caller under test, with its settings in `RULES`. The header comment gives every rule. |
| `plate-tracker.ts` | Item 70's plate tracker, plus the tap template's whole-frame search (`TapTemplate.searchAll`). |
| `track.ts` | How the traces were made from the grey frames. The stuck rule's whole-frame search lives here. Needs the frames, which are not committed. |
| `score.ts` | The scoring: the five lines below. |
| `eye.py` | The by-eye times (`data/eyetimes.json`), from the by-eye calls and the reference traces. It reproduces the committed file exactly. |
| `data/traces/` | The phone tracker's plate trace for each rep, with the whole-frame search. |
| `data/traces-no-search/` | The same tracker without the search, for comparison. |
| `data/reference/` | A separate CSRT tracker's bar height for each rep (`t` s, `y` fraction of the frame, top = 0). Used only for the eye times. |
| `data/calls-meet.json`, `data/calls-run1.json` | The by-eye calls: the Start! window and each rep's bottom start and pause end, in seconds of the clip. |
| `data/marks-*.json` | Where and when the plate was tapped. |
| `results/` | The scorer's output for each variant: settings, the five lines and every rep's times. |

**Trace format:** `{ id, w, h, racked, mark, pts }`, with `pts` a list of `[t ms, x, y, score, found]`. x and y are
fractions of the 284×160 frame. `score` is the template match (0–1). `found` is 1 on a frame where the whole-frame search
moved the tracker.

## How it is scored

These are the 22 reps from item 70: 9 meet reps and 13 run-1 reps. Four of the run-1 reps bounce (m-k8, Nv9h, VM_y, xXFj).
Lines 1, 2 and 5 cover the 18 paused reps. Lines 3 and 4 cover all 22.

The lifters followed a real referee, not this phone. So if the phone hasn't called Start! by the eye's descent (less 0.1 s),
or Press! by the moment she rose, the clip is held there. The last 0.4 s plays back and forth until the command comes, plus
0.3 s to react, for at most 3 s. Every later time, by eye and by phone, moves by the wait.

1. No Press! while the bar is still going down: no more than 1% of the frame lower after Press! (3-frame median).
2. Press! within 1 s of the stop on at least 90% of reps, and none past 1.5 s unless it was a late Press!.
3. No Start! before the bar settled.
4. No Rack! before the bar is back up.
5. "Back up" (Press! and Rack! both came, and not the no-rep Rack!) agrees with the eye.

## Results (commit of this README)

| Variant | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| With the whole-frame search (`results/with-search.json`) | pass | pass, 18 of 18 | pass* | pass | **fail: IA0P** |
| Without the search (`results/no-search.json`) | pass | pass, 18 of 18 | pass* | pass | pass |
| Stuck time 0.3 s (`results/stuck-0.3s.json`) | pass | pass, 17 of 18 | pass* | pass | **fail: IA0P** |

\* m-k8, Nv9h and VM_y get no Start! at all, so they can't be early. That's no command, not a right one.

On IA0P, the search jumps to a medicine ball while the track is stuck. It then follows the ball, which stays still while the
bar rises, so there's no Rack!. With a stuck time of 0.3 s, IA0P's real held bar counts as lost before Start!.
