# Implementation plan

6 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

The riskiest unknown goes first: whether an unattended background agent can sit through a 70-minute command and carry on. Its answer sets the wording of the instructions every agent gets, so T01 waits on it. All rules are then built and proven with a fake `claude` before anything starts a real agent. Real starts come last, from the owner's own test entry.

```
Phase 0  ▸  T00            prove the long run         throwaway, ~70 min
Phase 1  ▸  T01 T02        rules; calendar flag       no real agent
Phase 2  ▸  T03 T04        starter; daemon wiring     fake claude only
Phase 3  ▸  T05            real entry, real agent     needs the owner briefly
```

## Phase 0 — Prove the long run

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-long-command-spike.md) | long-command-spike | — |

T00 gates the long-command wording in DESIGN §2.5. If the agent survives, the plain wording stands. If the command is cut off or the agent stops early, T00 records what held instead, and if nothing did, the owner decides before T01.

## Phase 1 — The rules and the calendar

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-job-decisions.md) | job-decisions | T00 |
| [T02](tasks/T02-jobs-calendar.md) | jobs-calendar | — |

At the end, every rule is implemented and tested, and a calendar can be marked and its entries' instructions cached.

## Phase 2 — Running

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-job-starter.md) | job-starter | T01 |
| [T04](tasks/T04-daemon-wiring.md) | daemon-wiring | T02, T03 |

At the end, the daemon starts agents from the cache in tests, against a fake `claude`.

## Phase 3 — Live

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-live-check.md) | live-check | T00, T04 |

At the end, a real entry on a real calendar has started a real agent. The live daemon gets the code only when the branch is merged and the cockpit window reopened, so the first real night is after the merge.

---

## Main path: builder and wirer

| Step | Built by | Wired by |
|---|---|---|
| Mark the calendar | T02 | T02 (`agenda` command dispatch) |
| Fetch instructions and creator | T02 | T04 (`refreshAgenda` passes `jobs`, wider window) |
| Decide what starts | T01 | T03 (`jobsTick`) |
| Start the agent, keep the ledger, write notes | T03 | T04 (`cockpitd.mjs` timer and recovery at start) |
| Agent listed and reporting | Claude Code | T00 and T05 prove it |

## Critical path

```
T00 → T01 → T03 → T04 → T05
```

T02 is off it and can run alongside T00, T01 or T03.

Leaves: only T05, the final deliverable.

## Parallel width

6 tasks · longest dependency chain 5 · up to 2 could run at once. Serial by nature; a coordinator saves little here.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T01 |
| **Medium** | T02, T03, T04 |
| **Light** | T00 (long wait, little work), T05 |

T01 is where the rules concentrate. T00 can overrun if the suite takes longer than 70 minutes; `~/.pir/superfrog-re/settings.json` allows it 120.

## Decisions still open

Nothing blocks. T00's outcome may return a decision to the owner. After merge, the window must be reopened for the daemon to pick up the code; this repo has no `.pir/rules/on-finish.md`, so that step is named to the owner and no task takes it.
