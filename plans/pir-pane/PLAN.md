# Implementation plan

8 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means. Track state in [PROGRESS.md](PROGRESS.md). Read
[DESIGN.md](DESIGN.md) first. The pir side is a separate plan in `~/src/plan-implement-review`,
started from [PIR-PROMPT.md](PIR-PROMPT.md); only T07 waits for it.

---

## Shape of the build

- The riskiest unknown goes first. T00 proves on a real headless mux that the fleet slot can
  swap programs without disturbing the bottom row, and that `panes.foot` holds as the landmark,
  before T03 rewires the daemon around it.
- The pure decision (T01) and the footer (T02) are built alongside T00, since neither needs it.
- The daemon swap (T03) lands before following (T04), so following is added to a pane that
  already switches correctly and only one change to the daemon is in flight at a time.
- The cockpit follows pir through a file the tests write themselves, so nothing here waits on
  the pir plan except the live check (T07).

```
Phase 0  ▸  T00              swap-spike              throwaway, real headless mux
Phase 1  ▸  T01 T02          model, footer           pure / renderer
Phase 2  ▸  T03 T04          swap, follow            daemon
Phase 3  ▸  T05 T06 T07      docs, drill, live       finish
```

---

## Phase 0 — Prove the ground

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-swap-spike.md) | swap-spike | — |

T00 gates the swap order and split direction T03 uses, and whether `panes.foot` can be the tab
landmark. If the split-into-outgoing order does not give the incoming pane the full slot, or pir
does not redraw after a park, T03's approach changes and the plan comes back to the person.

## Phase 1 — The parts

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-pir-model.md) | pir-model | — |
| [T02](tasks/T02-footer-switch.md) | footer-switch | — |

At the end, the decision of §2.5–§2.6 is proven exhaustively and the footer draws and clicks the
segment from a hand-written `terminals.json`.

## Phase 2 — The daemon

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-program-swap.md) | program-swap | T00 |
| [T04](tasks/T04-pir-follow.md) | pir-follow | T01, T03 |

At the end, the cockpit switches programs and follows a `pir-dashboard.json` written by tests.

## Phase 3 — Finish

| # | Task | Depends on |
|---|---|---|
| [T05](tasks/T05-docs.md) | docs | T04 |
| [T06](tasks/T06-pir-pane-drill.md) | pir-pane-drill | T02, T04 |
| [T07](tasks/T07-live-check.md) | live-check | T05, T06, and the pir plan built |

---

## Critical path

```
T00 → T03 → T04 → T06 → T07
```

T01 and T02 are off it and can run beside T00. T05 runs beside T06.

Leaves: T07 only.

## Parallel width

8 tasks · longest dependency chain 5 · up to 3 could run at once (T00, T01, T02).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | T03, T04 |
| **Medium** | T00, T01, T06 |
| **Light** | T02, T05, T07 |

T03 will overrun if more of the daemon leans on `panes.fleet` than the survey found; the list in
T03 is from a read of the code, not a guarantee.

## Decisions still open

None blocking. T07 cannot finish until the pir plan is built; that plan's slug and timing are the
person's.
