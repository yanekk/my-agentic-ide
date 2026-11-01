# calendar-agents — run stats

Build of `pir/calendar-agents` in agentic-ide, 2026-10-31 16:45 → 2026-11-01 07:11 UTC, finished. Written by pir at the end of the run.

|  | Total | Detail |
| --- | ---: | --- |
| wall-clock | 14h25m | 14h25m running, 0s stopped |
| workers busy | 2h06m | 0.1× parallel, peak 3 of 4 |
| tests | 37m |  |
|     agent-driven | 34m | 28% of worker time, 30 runs |
|     pir-driven | 2m | 2m end gate |
| waited on you | 9h15m | 9h14m with nothing else moving |
| pir's own steps | 10m | 3s of it holding the run |
| tokens | 22.6M | 20.3M cache read |

## By task

| Task | Implement | Review | Agent-driven tests | Tokens | Waited on you |
| --- | ---: | ---: | ---: | ---: | ---: |
| T00 | 2m | 2m | 0s | 3.1M | 44s |
| T01 | 27m | 31m | 13m | 4.3M | — |
| T02 | 3m | 2m | 7s | 1.7M | — |
| T03 | 4m | 19m | 15m | 1.1M | — |
| T04 | 5m | 7m | 1m | 3.3M | — |
| T05 | 5m | 8m | 3m | 2.6M | 8h55m |
| T06 | 2m | 2m | 9s | 3.4M | 18m |

## Work by role

| Role | Sessions | Active | Model | Tools | Tests | Tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| implementers | 7 | 52m | 24m | 28m | 2m | 10.6M |
| reviewers | 7 | 1h14m | 18m | 56m | 32m | 9.1M |
| coordinator agent | 1 | 2m | 1m | 49s | 0s | 2.8M |
| workers total | 14 | 2h06m | 42m | 1h24m | 34m |  |

Workers are the implementers, reviewers and the two helpers. The coordinator agent and the finisher count in tokens only, never in worker time or parallelism.

## Tests

### agent-driven

Workers running `pir-test` in their own sessions.

| Kind | Runs | Time | Average |
| --- | ---: | ---: | ---: |
| full | 11 | 31m | 2m |
| partial | 19 | 3m | 10s |
| full, ran without pir-test | 0 | 0s | — |
| agent-driven total | 30 | 34m | 1m |

28% of worker active time, and part of it. Untimed runs (started in the background): 0.

### pir-driven

pir running the suite itself, one suite at a time on the machine.

| Kind | Runs | Time | Average |
| --- | ---: | ---: | ---: |
| end gate | 1 | 2m | 2m |
| pir-driven total | 1 | 2m | 2m |
| task setup (not a test run) | 0 | 0s | — |

The end gate's time includes its wait for its turn. Task setup is not in the total.

## Parallelism

0.1× average, peak 3, ceiling 4. Ready tasks waiting for a slot: 1s.

| Workers busy | Time | Share of running time |
| ---: | ---: | ---: |
| 0 | 12h43m | 88% |
| 1 | 1h18m | 9% |
| 2 | 21m | 2% |
| 3 | 1m | 0% |

## pir's own steps

| Step | Count | Total | Holding the run | Left open |
| --- | ---: | ---: | ---: | ---: |
| start-up | 1 | 0s | 0s | 0 |
| reconcile | 1 | 0s | 0s | 0 |
| worktree create | 7 | 1s | 1s | 0 |
| waiting for a slot | 4 | 1s | — | 0 |
| report pick-up | 20 | 2s | — | 0 |
| hand-off, wait idle | 14 | 6m | — | 0 |
| merge | 7 | 1s | 1s | 0 |
| worktree remove | 7 | 0s | 0s | 0 |
| base sync | 1 | 2s | — | 0 |
| end gate | 1 | 2m | — | 0 |
| report | 1 | 21s | — | 0 |
| session start-up | 15 | 14s | — | 0 |
| pir's own total |  | 10m | 3s |  |

Session start-up is not in the total; pir's step time overlaps worker time and is never added to it.

Listed apart, since they contain other steps or are not pir's work:

| Step | Count | Total | Left open |
| --- | ---: | ---: | ---: |
| coordinator running | 1 | 14h25m | 1 |
| loop pass | 11882 | 2m | 0 |
| waiting on someone | 13 | 9h16m | 0 |

## Waiting

| On | Time | Times |
| --- | ---: | ---: |
| you | 9h15m | 8 |
| coordinator agent | 45s | 5 |
| nothing else moving, waiting on you | 9h14m |  |

## Tokens by model

| Model | Input | Output | Cache read | Cache write |
| --- | ---: | ---: | ---: | ---: |
| claude-opus-5-5 | 438 | 269k | 20.3M | 2.0M |
| total | 438 | 269k | 20.3M | 2.0M |

Limits (machine-wide: includes anything else you ran): 5-hour 10% → 10%, weekly 50% → 50%.
