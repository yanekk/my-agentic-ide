# Implementation plan

7 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

The riskiest unknown goes first: whether an unattended background agent can sit through a 70-minute command and carry on. Its answer sets the wording of the instructions every agent gets, so T02 waits on it. All rules are then built and proven with a fake `claude` before anything starts a real agent. Real starts come last, from the owner's own test entry.

```
Phase 0  ▸  T00 T01        prove the long run; steady suite   ~70 min; light
Phase 1  ▸  T02 T03        rules; calendar flag       no real agent
Phase 2  ▸  T04 T05        starter; daemon wiring     fake claude only
Phase 3  ▸  T06            real entry, real agent     no person needed
```

## Phase 0 — Prove the long run, steady the suite

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-long-command-spike.md) | long-command-spike | — |
| [T01](tasks/T01-cockpit-suite-flake.md) | cockpit-suite-flake | — |

T00 gates the long-command wording in DESIGN §2.5. If the agent survives, the plain wording stands. If the command is cut off or the agent stops early, T00 records what held instead, and if nothing did, the owner decides before T02.

## Phase 1 — The rules and the calendar

| # | Task | Depends on |
|---|---|---|
| [T02](tasks/T02-job-decisions.md) | job-decisions | T00 |
| [T03](tasks/T03-jobs-calendar.md) | jobs-calendar | — |

At the end, every rule is implemented and tested, and a calendar can be marked and its entries' instructions cached.

## Phase 2 — Running

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-job-starter.md) | job-starter | T02, T03 |
| [T05](tasks/T05-daemon-wiring.md) | daemon-wiring | T01, T03, T04 |

At the end, the daemon starts agents from the cache in tests, against a fake `claude`.

## Phase 3 — Live

| # | Task | Depends on |
|---|---|---|
| [T06](tasks/T06-live-check.md) | live-check | T00, T05 |

At the end, a real entry on a real calendar has started a real agent. The live daemon gets the code only when the branch is merged and the cockpit window reopened, so the first real night is after the merge.

---

## Main path: builder and wirer

| Step | Built by | Wired by |
|---|---|---|
| Mark the calendar | T03 | T03 (`agenda` command dispatch) |
| Fetch instructions and creator | T03 | T05 (`refreshAgenda` passes `jobs`, wider window) |
| Decide what starts | T02 | T04 (`jobsTick`) |
| Start the agent, keep the ledger, write notes | T04 | T05 (`cockpitd.mjs` timer and recovery at start) |
| Agent listed and reporting | Claude Code | T00 and T06 prove it |

## Critical path

```
T00 → T02 → T04 → T05 → T06
```

T01 and T03 are off it. T03 can run alongside T00 or T02; T01 alongside anything before T05.

Leaves: only T06, the final deliverable.

## Parallel width

7 tasks · longest dependency chain 5 · up to 3 could run at once. Serial by nature; a coordinator saves little here.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T02 |
| **Medium** | T03, T04, T05 |
| **Light** | T00 (long wait, little work), T01, T06 |

T02 is where the rules concentrate. T00 can overrun if the suite takes longer than 70 minutes; `~/.pir/superfrog-re/settings.json` allows it 120.

## Decisions still open

Nothing blocks. T00's outcome may return a decision to the owner. After merge, the window must be reopened for the daemon to pick up the code; this repo has no `.pir/rules/on-finish.md`, so that step is named to the owner and no task takes it.
