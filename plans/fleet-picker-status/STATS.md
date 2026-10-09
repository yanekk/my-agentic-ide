# fleet-picker-status — run stats

Build of `pir/fleet-picker-status` in my-agentic-ide, 2026-10-09 12:32 → 14:55 UTC, finished. Written by pir at the end of the run.

|  | Total | Detail |
| --- | ---: | --- |
| wall-clock | 2h22m | 2h22m running, 0s stopped |
| workers busy | 2h09m | 0.9× parallel, peak 2 of 4 |
| tests | 22m |  |
|     agent-driven | 21m | 16% of worker time, 32 runs |
|     pir-driven | 1m | 1m end gate |
| waited on you | 41m | 22m with nothing else moving |
| pir's own steps | 6m | 3s of it holding the run |
| tokens | 28.2M | 26.0M cache read |

## By task

| Task | Implement | Review | Agent-driven tests | Tokens | Waited on you |
| --- | ---: | ---: | ---: | ---: | ---: |
| T00 | 6m | 4m | 37s | 3.0M | 41m |
| T01 | 5m | 4m | 1m | 3.0M | — |
| T02 | 5m | 8m | 2m | 3.8M | — |
| T03 | 12m | 8m | 2m | 3.6M | — |
| T04 | 9m | 34m | 10m | 6.0M | — |
| T05 | 15m | 5m | 1m | 4.8M | — |
| T06 | 3m | 3m | 1m | 2.3M | — |

## Work by role

| Role | Sessions | Active | Model | Tools | Tests | Tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| implementers | 7 | 59m | 44m | 15m | 7m | 12.0M |
| reviewers | 7 | 1h09m | 38m | 31m | 13m | 14.8M |
| coordinator agent | 1 | 3m | 2m | 28s | 0s | 1.4M |
| workers total | 14 | 2h09m | 1h22m | 46m | 21m |  |

Workers are the implementers, reviewers and the two helpers. The coordinator agent and the finisher count in tokens only, never in worker time or parallelism.

## Tests

### agent-driven

Workers running `pir-test` in their own sessions.

| Kind | Runs | Time | Average |
| --- | ---: | ---: | ---: |
| full | 9 | 10m | 1m |
| partial | 23 | 10m | 28s |
| full, ran without pir-test | 0 | 0s | — |
| agent-driven total | 32 | 21m | 39s |

16% of worker active time, and part of it. Untimed runs (started in the background): 0.

### pir-driven

pir running the suite itself, one suite at a time on the machine.

| Kind | Runs | Time | Average |
| --- | ---: | ---: | ---: |
| end gate | 1 | 1m | 1m |
| pir-driven total | 1 | 1m | 1m |
| task setup (not a test run) | 0 | 0s | — |

The end gate's time includes its wait for its turn. Task setup is not in the total.

## Parallelism

0.9× average, peak 2, ceiling 4. Ready tasks waiting for a slot: 1s.

| Workers busy | Time | Share of running time |
| ---: | ---: | ---: |
| 0 | 25m | 18% |
| 1 | 1h44m | 73% |
| 2 | 12m | 9% |

## pir's own steps

| Step | Count | Total | Holding the run | Left open |
| --- | ---: | ---: | ---: | ---: |
| start-up | 1 | 0s | 0s | 0 |
| reconcile | 1 | 0s | 0s | 0 |
| worktree create | 7 | 1s | 1s | 0 |
| waiting for a slot | 5 | 1s | — | 0 |
| report pick-up | 15 | 0s | — | 0 |
| hand-off, wait idle | 14 | 4m | — | 0 |
| merge | 7 | 1s | 1s | 0 |
| worktree remove | 7 | 0s | 0s | 0 |
| base sync | 1 | 1s | — | 0 |
| end gate | 1 | 1m | — | 0 |
| report | 1 | 25s | — | 0 |
| session start-up | 15 | 10s | — | 0 |
| pir's own total |  | 6m | 3s |  |

Session start-up is not in the total; pir's step time overlaps worker time and is never added to it.

Listed apart, since they contain other steps or are not pir's work:

| Step | Count | Total | Left open |
| --- | ---: | ---: | ---: |
| coordinator running | 1 | 2h22m | 1 |
| loop pass | 2894 | 18s | 1 |
| waiting on someone | 4 | 42m | 0 |

## Waiting

| On | Time | Times |
| --- | ---: | ---: |
| you | 41m | 3 |
| coordinator agent | 28s | 1 |
| nothing else moving, waiting on you | 22m |  |

## Tokens by model

| Model | Input | Output | Cache read | Cache write |
| --- | ---: | ---: | ---: | ---: |
| us.anthropic.claude-opus-5-5[1m] | 580 | 181k | 26.0M | 1.9M |
| total | 580 | 181k | 26.0M | 1.9M |

Limits (machine-wide: includes anything else you ran): 5-hour not available, weekly not available.
