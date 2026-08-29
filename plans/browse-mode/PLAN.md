# Implementation plan

8 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches,
the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **The riskiest unknown goes first, as a spike.** Browse mode makes the diff slot's parking
  area hold *two* panes per agent where it held one (DESIGN §2.6). Everything in Phase 2 rides
  on that working. T00 proves it against a headless mux before a line of daemon code exists —
  and finding out in an afternoon that it does not work is the cheapest outcome available.
- **Everything testable automatically is built and tested before anything touches a pane.**
  By the end of Phase 1 the whole push mechanism is implemented and proven headlessly; Phase 2
  then wires panes to logic already known to be correct.
- **The dangerous thing is built small before it is built full size.** Every pane experiment
  runs against a headless `wezterm-mux-server` with its own socket, never the live cockpit
  window (DESIGN §5.2).
- **Recovery before the thing that needs recovering.** T06 builds the healing — a quit viewer,
  a reaped agent — and it lands before the feature is handed to the user in T07, not after.

```
Phase 0  ▸  T00              prove the slot holds two            throwaway probe + RESULTS
Phase 1  ▸  T01 T02 T03      the push, headless                  no pane is touched
Phase 2  ▸  T04 T05 T06      the daemon                          cockpit-test stays green
Phase 3  ▸  T07              seen working, by a person
```

---

## Phase 0 — Prove the ground

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-two-pane-slot-spike.md) | Prove revdiff and micro can alternate in the diff slot for one agent | — |

**T00 gates T05, and through it the whole of Phase 2.** If the slot cannot hold two
alternating panes per agent with its geometry intact, DESIGN §2.6 is wrong and the choice
becomes: kill and relaunch the viewer on every cycle (tabs die — the feature loses its point),
or browse mode stops being a stop in the cycle. Either is a decision for the user, and T00 is
where it would surface.

It also promotes the four probes already run during planning into the repo, so the numbers in
DESIGN §2.4 and §2.6 can be re-run rather than believed.

**At the end of Phase 0:** the architecture is either confirmed or the plan is back with the
user, and the measurements live in `spikes/` instead of a scratch directory.

## Phase 1 — The push, headless

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-open-model.md) | `cockpit-open-model.mjs` — the pure open/tab/tabswitch decision | — |
| [T02](tasks/T02-open-command.md) | `cockpit-open.mjs` — pane lookup, locked tab state, sending | T01 |
| [T03](tasks/T03-browse-command.md) | The `browse` command and the cockpit's broot verb layer | T02 |

**At the end of Phase 1:** running `browse` in a cockpit terminal opens broot, and Enter on a
file pushes it into a micro that is *already running* — provided something put one in the diff
slot by hand. Nothing knows about modes yet.

## Phase 2 — The daemon

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-fourth-mode.md) | `browse` as the fourth stop; publish it to the strip and footer | — |
| [T05](tasks/T05-viewer-park.md) | Park and restore the viewer pane instead of killing it | T00, T04 |
| [T06](tasks/T06-heal-and-reap.md) | A quit viewer is reinstated; a reaped agent's viewer is disposed | T05 |

**At the end of Phase 2:** `⌥]` reaches browse, the viewer comes and goes with its tabs, and
the unhappy paths in DESIGN §2.n are covered. `spikes/cockpit-test/run.sh` is still green.

## Phase 3 — Seen working

| # | Task | Depends on |
|---|---|---|
| [T07](tasks/T07-live-verification.md) | Verified by hand, in a real cockpit, with the user | T03, T06 |

**At the end of Phase 3:** somebody has actually looked at it. Until then nothing in this plan
is known to draw correctly — see DESIGN §5.1.

---

## Critical path

```
T00 ──> T05 ──> T06 ──┐
                      ├──> T07
T01 ──> T02 ──> T03 ──┘
T04 ──> T05
```

**T00 → T04 → T05 → T06 → T07.** T01–T03 are off the critical path and could be done by any
session that finds Phase 2 blocked.

## Sizing

| Task | Weight | Where the work is |
|---|---|---|
| T00 | medium | Four probes, one of them new; a RESULTS.md worth reading |
| T01 | light | One pure function and its table of cases |
| T02 | medium | Locking, atomic writes, refusals, a stubbed `wezterm` |
| T03 | light | A launcher and a five-line hjson, published like `note` |
| T04 | medium | Small daemon change, but it touches the strip and the footer |
| **T05** | **heavy** | Two panes per agent in a slot that has always held one |
| T06 | medium | Healing and reaping, both cooldown-guarded |
| T07 | light | Minutes of the user's time — but the session waits for it |

## Still open

- **The `browse` command name and its cockpit-only publication** (DESIGN §2.3, T03) is an
  assumption, not a decision. The user was asked twice and did not answer; this was the
  recommendation and no objection was raised. **T03 must raise it once more before building.**
