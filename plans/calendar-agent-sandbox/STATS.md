# calendar-agent-sandbox — run stats

Build of `pir/calendar-agent-sandbox` in agentic-ide, 2026-11-01 11:06 → 15:00 UTC, finished. Written by pir at the end of the run.

|  | Total | Detail |
| --- | ---: | --- |
| wall-clock | 3h53m | 3h53m running, 0s stopped |
| workers busy | 2h19m | 0.6× parallel, peak 2 of 4 |
| tests | 25m |  |
|     agent-driven | 16m | 12% of worker time, 30 runs |
|     pir-driven | 8m | 8m end gate |
| waited on you | 24m | 24m with nothing else moving |
| pir's own steps | 13m | 2s of it holding the run |
| tokens | 41.9M | 39.0M cache read |

## By task

| Task | Implement | Review | Agent-driven tests | Tokens | Waited on you |
| --- | ---: | ---: | ---: | ---: | ---: |
| T00 | 32m | 11m | 0s | 12.0M | 18m |
| T01 | 4m | 4m | 1m | 2.8M | — |
| T02 | 2m | 3m | 47s | 1.7M | — |
| T03 | 3m | 4m | 0s | 2.5M | — |
| T04 | 5m | 5m | 1m | 2.6M | — |
| T05 | 9m | 6m | 2m | 2.9M | — |
| T06 | 4m | 3m | 35s | 2.3M | — |
| T07 | 21m | 7m | 7m | 7.1M | 5m |
| T08 | 3m | 3m | 1m | 2.2M | — |

## Work by role

| Role | Sessions | Active | Model | Tools | Tests | Tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| implementers | 9 | 1h28m | 49m | 38m | 2m | 23.4M |
| reviewers | 9 | 51m | 28m | 22m | 14m | 13.0M |
| coordinator agent | 1 | 3m | 2m | 39s | 0s | 5.3M |
| workers total | 18 | 2h19m | 1h18m | 1h01m | 16m |  |

Workers are the implementers, reviewers and the two helpers. The coordinator agent and the finisher count in tokens only, never in worker time or parallelism.

## Tests

### agent-driven

Workers running `pir-test` in their own sessions.

| Kind | Runs | Time | Average |
| --- | ---: | ---: | ---: |
| full | 0 | 0s | — |
| partial | 27 | 15m | 33s |
| full, ran without pir-test | 3 | 1m | 20s |
| agent-driven total | 30 | 16m | 32s |

12% of worker active time, and part of it. Untimed runs (started in the background): 0.

### pir-driven

pir running the suite itself, one suite at a time on the machine.

| Kind | Runs | Time | Average |
| --- | ---: | ---: | ---: |
| end gate | 1 | 8m | 8m |
| pir-driven total | 1 | 8m | 8m |
| task setup (not a test run) | 0 | 0s | — |

The end gate's time includes its wait for its turn. Task setup is not in the total.

## Parallelism

0.6× average, peak 2, ceiling 4. Ready tasks waiting for a slot: 2s.

| Workers busy | Time | Share of running time |
| ---: | ---: | ---: |
| 0 | 1h48m | 46% |
| 1 | 1h50m | 47% |
| 2 | 14m | 6% |

## pir's own steps

| Step | Count | Total | Holding the run | Left open |
| --- | ---: | ---: | ---: | ---: |
| start-up | 1 | 0s | 0s | 0 |
| reconcile | 1 | 0s | 0s | 0 |
| worktree create | 9 | 1s | 1s | 0 |
| waiting for a slot | 8 | 2s | — | 0 |
| report pick-up | 25 | 1s | — | 0 |
| hand-off, wait idle | 18 | 3m | — | 0 |
| merge | 9 | 0s | 0s | 0 |
| worktree remove | 9 | 0s | 0s | 0 |
| base sync | 1 | 1s | — | 0 |
| end gate | 1 | 8m | — | 0 |
| report | 1 | 34s | — | 0 |
| session start-up | 19 | 4s | — | 0 |
| pir's own total |  | 13m | 2s |  |

Session start-up is not in the total; pir's step time overlaps worker time and is never added to it.

Listed apart, since they contain other steps or are not pir's work:

| Step | Count | Total | Left open |
| --- | ---: | ---: | ---: |
| coordinator running | 1 | 3h53m | 1 |
| loop pass | 5147 | 49s | 0 |
| waiting on someone | 22 | 25m | 0 |

## Waiting

| On | Time | Times |
| --- | ---: | ---: |
| you | 24m | 16 |
| coordinator agent | 1m | 6 |
| nothing else moving, waiting on you | 24m |  |

## Tokens by model

| Model | Input | Output | Cache read | Cache write |
| --- | ---: | ---: | ---: | ---: |
| claude-opus-5-5 | 674 | 493k | 39.0M | 2.3M |
| total | 674 | 493k | 39.0M | 2.3M |

Limits (machine-wide: includes anything else you ran): 5-hour 30% → 30%, weekly 73% → 73%.
