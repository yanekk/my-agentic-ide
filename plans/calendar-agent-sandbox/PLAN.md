# Implementation plan

9 tasks in 4 phases. Each has a file in [tasks/](tasks/). Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

## Shape of the build

The riskiest unknowns go first as probes on real agents, because a wall that a resumed session loses, or a guard that fails open, changes the design. Everything decidable is then built and tested against the fake `claude`. Real agents return only for the trial and the final check.

```
Phase 0  ▸  T00                 settle the unknowns    throwaway
Phase 1  ▸  T01 T02 T03         pure rules and store   no real agent
Phase 2  ▸  T04 T05 T06         real starts, trial, skill
Phase 3  ▸  T07 T08             proof and docs
```

## Phase 0 — Settle the unknowns

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-wall-measurements.md) | wall-measurements | — |

T00 gates DESIGN §2.2 (allow list), §2.3 (guard's fail-shut form), §2.4 (branch list), §2.6 (caches), §2.8 (keychain), §2.9 (preflight, resume). A lost wall on resume stops the plan for an owner decision.

## Phase 1 — The rules

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-wall-rules.md) | wall-rules | T00 |
| [T02](tasks/T02-write-guard.md) | write-guard | T01 |
| [T03](tasks/T03-exceptions-list.md) | exceptions-list | T01 |

At the end every rule is proven in milliseconds and no run has changed yet.

## Phase 2 — Into real starts

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-confined-start.md) | confined-start | T01, T02, T03 |
| [T05](tasks/T05-trial-run.md) | trial-run | T04 |
| [T06](tasks/T06-skill-refactor.md) | skill-refactor | T03, T05 |

## Phase 3 — Proof and docs

| # | Task | Depends on |
|---|---|---|
| [T07](tasks/T07-wall-check.md) | wall-check | T04, T05 |
| [T08](tasks/T08-docs.md) | docs | T06, T07 |

## Main path: builder and wirer

| Step | Built by | Plugged in by |
|---|---|---|
| Settings and argv for a run | T01 | T04, `wallFor` passed to `decideJobs` in `jobsTick` |
| Guard | T02 | T01 names it in the settings; T04 passes its path and checks it in the preflight |
| Exceptions | T03 | T04's `wallFor` reads them; T03 adds the verb to `cockpit-agenda.mjs`'s dispatch |
| Refusal note | T01 wording | T04 |
| Trial | T05 | T06, the skill calls it |
| Skill | T06 | T06, `bin/install.sh` links it |

`cockpitd.mjs` already calls `jobsTick` and is unchanged.

## Critical path

```
T00 → T01 → T03 → T04 → T05 → T06 → T08
```

T02 and T07 are off it. The only leaf is T08.

## Parallel width

9 tasks · longest dependency chain 7 · up to 2 could run at once (T02 with T03; T06 with T07). Counted by hand from the table above. Mostly serial by nature.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T00, T04 |
| **Medium** | T01, T02, T03, T05, T07 |
| **Light** | T06, T08 |

T00 and T07 may overrun: superfrog's smoke test takes an unmeasured time and may need more than local ports. `spikes/cockpit-test` asserts the argv at one point (T01 updates it); its 2 min run is part of every review.

## Decisions still open

None block. Findings T00 could reopen: a wall lost on resume, a readable keychain secret, or superfrog needing an extra site. Each goes to the owner.
