# fleet-picker — run stats

Build of `pir/fleet-picker` in my-agentic-ide, 2026-10-07 10:01 → 2026-10-08 06:43 UTC, finished. Written by pir at the end of the run.

|  | Total | Detail |
| --- | ---: | --- |
| wall-clock | 20h42m | 20h42m running, 0s stopped |
| workers busy | 3h08m | 0.2× parallel, peak 2 of 4 |
| tests | 47m |  |
|     agent-driven | 41m | 22% of worker time, 26 runs |
|     pir-driven | 6m | 6m end gate |
| waited on you | 18h05m | 18h02m with nothing else moving |
| pir's own steps | 11m | 4s of it holding the run |
| tokens | 39.5M | 36.9M cache read |

## By task

| Task | Implement | Review | Agent-driven tests | Tokens | Waited on you |
| --- | ---: | ---: | ---: | ---: | ---: |
| T00 | 19m | 4m | 25s | 6.3M | 4m |
| T01 | 8m | 4m | 32s | 3.9M | — |
| T02 | 15m | 5m | 6m | 4.5M | — |
| T03 | 23m | 20m | 16m | 8.5M | — |
| T04 | 53m | 17m | 15m | 10.7M | — |
| T05 | 2m | 2m | 51s | 2.4M | — |
| T06 | 5m | 5m | 32s | 1.8M | 18h00m |

## Work by role

| Role | Sessions | Active | Model | Tools | Tests | Tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| implementers | 7 | 2h08m | 1h03m | 1h05m | 22m | 26.9M |
| reviewers | 7 | 1h00m | 27m | 33m | 19m | 11.5M |
| coordinator agent | 1 | 2m | 1m | 1m | 0s | 1.1M |
| workers total | 14 | 3h08m | 1h30m | 1h38m | 41m |  |

Workers are the implementers, reviewers and the two helpers. The coordinator agent and the finisher count in tokens only, never in worker time or parallelism.

## Tests

### agent-driven

Workers running `pir-test` in their own sessions.

| Kind | Runs | Time | Average |
| --- | ---: | ---: | ---: |
| full | 8 | 6m | 50s |
| partial | 18 | 35m | 1m |
| full, ran without pir-test | 0 | 0s | — |
| agent-driven total | 26 | 41m | 1m |

22% of worker active time, and part of it. Untimed runs (started in the background): 0.

### pir-driven

pir running the suite itself, one suite at a time on the machine.

| Kind | Runs | Time | Average |
| --- | ---: | ---: | ---: |
| end gate | 1 | 6m | 6m |
| pir-driven total | 1 | 6m | 6m |
| task setup (not a test run) | 0 | 0s | — |

The end gate's time includes its wait for its turn. Task setup is not in the total.

## Parallelism

0.2× average, peak 2, ceiling 4. Ready tasks waiting for a slot: 1s.

| Workers busy | Time | Share of running time |
| ---: | ---: | ---: |
| 0 | 18h09m | 88% |
| 1 | 1h57m | 9% |
| 2 | 35m | 3% |

## pir's own steps

| Step | Count | Total | Holding the run | Left open |
| --- | ---: | ---: | ---: | ---: |
| start-up | 1 | 0s | 0s | 0 |
| reconcile | 1 | 0s | 0s | 0 |
| worktree create | 7 | 1s | 1s | 0 |
| waiting for a slot | 5 | 1s | — | 0 |
| report pick-up | 16 | 0s | — | 0 |
| hand-off, wait idle | 14 | 3m | — | 0 |
| merge | 7 | 2s | 2s | 0 |
| worktree remove | 7 | 0s | 0s | 0 |
| base sync | 1 | 1s | — | 0 |
| end gate | 1 | 6m | — | 0 |
| report | 1 | 1m | — | 0 |
| session start-up | 15 | 10s | — | 0 |
| pir's own total |  | 11m | 4s |  |

Session start-up is not in the total; pir's step time overlaps worker time and is never added to it.

Listed apart, since they contain other steps or are not pir's work:

| Step | Count | Total | Left open |
| --- | ---: | ---: | ---: |
| coordinator running | 1 | 20h42m | 1 |
| loop pass | 16135 | 2m | 1 |
| waiting on someone | 6 | 18h05m | 0 |

## Waiting

| On | Time | Times |
| --- | ---: | ---: |
| you | 18h05m | 4 |
| coordinator agent | 13s | 2 |
| nothing else moving, waiting on you | 18h02m |  |

## Tokens by model

| Model | Input | Output | Cache read | Cache write |
| --- | ---: | ---: | ---: | ---: |
| us.anthropic.claude-opus-5-5[1m] | 720 | 257k | 36.9M | 2.4M |
| total | 720 | 257k | 36.9M | 2.4M |

Limits (machine-wide: includes anything else you ran): 5-hour not available, weekly 9% → 9%.
