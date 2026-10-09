# Implementation plan

7 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means. Track state in [PROGRESS.md](PROGRESS.md). Read
[DESIGN.md](DESIGN.md) first; it builds on `plans/fleet-picker/DESIGN.md`, which still holds.

---

## Shape of the build

- The riskiest unknown goes first. Claude's background-agent states and its `lastTerminalAt`
  finish time are undocumented, so T00 observes them on this machine before the model maps them.
- Everything that decides what is shown is pure and tested in milliseconds (T01, T03) before the
  process draws it (T04).
- The fetching (T02) is tested against a fake `claude` and a stand-in pir service, never the real
  machine, so the suite is free and repeatable.
- The drill (T05) drives the whole picker at both sizes in every situation of the prototype, and
  once against the real machine read-only.

```
Phase 0  ▸  T00              claude-status-spike    throwaway
Phase 1  ▸  T01 T02 T03      model, gather, render  pure + shell parts
Phase 2  ▸  T04              picker-wiring          the process, end to end
Phase 3  ▸  T05 T06          drill, docs            finish
```

---

## Phase 0 — Prove the ground

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-claude-status-spike.md) | claude-status-spike | — |

T00 gates DESIGN §2.2's Claude column and §2.3's finish time. If `blocked` is not what a waiting
agent reports, T01 maps whatever is; if `lastTerminalAt` does not move on a second finish, the
hour rule needs another source and the plan comes back to the person.

## Phase 1 — The parts

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-status-model.md) | status-model | T00 |
| [T02](tasks/T02-status-gather.md) | status-gather | T00 |
| [T03](tasks/T03-picker-render.md) | picker-render | — |

At the end, raw answers turn into ordered items (T01), both sources are fetched with every failure
handled (T02), and the picker model draws lists at both sizes (T03). T03 renders the Item shape of
DESIGN §3.3 and needs none of the others' code.

## Phase 2 — Put together

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-picker-wiring.md) | picker-wiring | T01, T02, T03 |

At the end, the real picker draws at once, fetches once and redraws, proven under a pty.

## Phase 3 — Finish

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-picker-status-drill.md) | picker-status-drill | T04 |
| [T06](tasks/T06-docs.md) | docs | T05 |

---

## Critical path

```
T00 → T01 → T04 → T05 → T06
```

T02 runs beside T01; T03 beside T00 and T01.

Leaves: T06 only.

## Parallel width

7 tasks · longest dependency chain 5 · up to 3 could run at once (T01, T02, T03).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T04 |
| **Medium** | T01, T02, T03, T05 |
| **Light** | T00, T06 |

T04 will overrun if the existing process tests, which snapshot the frame right after it appears,
race the redraw; they need a scratch environment and a wait on the filled-in lists.

## Decisions still open

- pir's `endedAt` ([pir-ended-at.md](pir-ended-at.md)) is the person's to start in the pir repo.
  It blocks nothing here: until it lands, finished pir runs are hidden (DESIGN §2.3).
