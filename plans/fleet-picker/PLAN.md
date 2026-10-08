# Implementation plan

7 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means. Track state in [PROGRESS.md](PROGRESS.md). Read
[DESIGN.md](DESIGN.md) first; it builds on `plans/pir-pane/DESIGN.md`, which still holds except
for its "no key" decision.

---

## Shape of the build

- The riskiest unknown goes first. Binding plain ← touches every pane in the window, so T00
  proves on the real GUI that a callback can read the screen and forward ← without lag or loss,
  and measures Claude's echo time and the picker's open time, before anything is built on it.
- The two pure halves (the Lua decision in T01, the picker model in T02) are tested in
  milliseconds; T02 does not need T00 and runs beside it.
- The daemon change (T03) lands on a picker screen that already exists, so the drill (T04) drives
  the whole flow on a real mux.
- The live window is rebuilt once, at the end (T06).

```
Phase 0  ▸  T00              keypress-spike     throwaway; real GUI with the person
Phase 1  ▸  T01 T02          key, screen        pure + wiring
Phase 2  ▸  T03              daemon             the swap
Phase 3  ▸  T04 T05 T06      drill, docs, live  finish
```

---

## Phase 0 — Prove the ground

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-keypress-spike.md) | keypress-spike | — |

T00 gates the Stance of DESIGN §1. If the GUI callback adds visible lag, drops or reorders keys,
or re-enters its own binding through `SendKey`, the decision cannot live in WezTerm and the plan
comes back to the person. Its open-time measurement decides whether T03 adds a directory watch to
the cmd tail.

## Phase 1 — The parts

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-key-binding.md) | key-binding | T00 |
| [T02](tasks/T02-picker-screen.md) | picker-screen | — |

At the end, ← in the GUI appends `picker` under exactly DESIGN §2.1's conditions (proven against
fixtures), and the picker screen draws, reads keys and hands back a verb on its own.

## Phase 2 — The daemon

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-daemon-picker.md) | daemon-picker | T00, T02 |

At the end, the daemon publishes the armed block, opens and closes the picker, and the guards of
§2.6 hold, all under cockpit-test.

## Phase 3 — Finish

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-picker-drill.md) | picker-drill | T02, T03 |
| [T05](tasks/T05-docs.md) | docs | T01, T03 |
| [T06](tasks/T06-live-check.md) | live-check | T04, T05 |

---

## Critical path

```
T00 → T03 → T04 → T06
```

T02 runs beside T00; T01 beside T03; T05 beside T04.

Leaves: T06 only.

## Parallel width

7 tasks · longest dependency chain 4 · up to 2 could run at once (`analyzeParallelism`).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T03 |
| **Medium** | T00, T01, T02, T04 |
| **Light** | T05, T06 |

T03 will overrun if the generalised swap disturbs the pir-pane paths (spawn-on-first-use, the pir
follow, `spawnAgent`); cockpit-test's existing pir-pane sections are the guard. T00 will overrun if
the GUI callback cannot read pane text in 20240203, which would reopen the design.

## Decisions still open

None block. T00's measurements set two technical details: whether the cmd tail gains a directory
watch (T03), and whether the markers survive the 39×12 slot (T01).
