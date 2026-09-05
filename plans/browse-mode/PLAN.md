# Implementation plan

8 tasks in 4 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches,
the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## What is being built

`⌥]` past `custom` splits the top pane in two: **the file browser on the left, a tabbed read-only
viewer on the right**. Enter on a file in the browser opens it as a tab beside it. Nothing is
typed — the gesture is the whole interface — and cycling away parks both panes so everything is
still there when you come back.

*(The shape changed at plan review. The first draft put the browser in a bottom-right terminal
behind a `browse` command; the user chose both in the top pane instead, and the pair was then
measured parking and restoring at identical geometry. DESIGN §3.1 and §7 carry the reversal and
the measurement.)*

---

## Shape of the build

- **The riskiest unknown goes first, as a spike.** Browse mode puts *two* panes in the diff slot
  and up to three per agent in its parking area (DESIGN §2.6). The core round trip was measured
  at plan review and works; T00 turns that into a re-runnable spike and pushes on what it did not
  reach — two agents both browsing, the empty-slot rebuild, a resize while parked, and what the
  extra park actually costs in time.
- **Everything testable automatically is built and tested before anything touches a pane.**
  By the end of Phase 1 the whole push mechanism is implemented and proven headlessly; Phase 2
  then wires panes to logic already known to be correct.
- **The dangerous thing is built small before it is built full size.** Every pane experiment
  runs against a headless `wezterm-mux-server` with its own socket, never the live cockpit
  window (DESIGN §5.2).
- **Nothing lands on `main` in a state that fights itself.** T04 carries the pane detection that
  would otherwise arrive in T06 — without it the cockpit's 1 s self-healer mistakes a healthy
  browser and viewer for broken panes and types over both. Measured; see FINDINGS.
- **Recovery before the thing that needs recovering.** T06 builds the healing — a quit half, a
  reaped agent — and it lands before the feature is handed to the user in T07, not after.

```
Phase 0  ▸  T00              prove the pair in the slot          throwaway probe + RESULTS
Phase 1  ▸  T01 T02 T03      the push, headless                  no pane is touched
Phase 2  ▸  T04 T05 T06      the daemon                          cockpit-test stays green
Phase 3  ▸  T07              seen working, by a person
```

---

## Phase 0 — Prove the ground

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-pair-slot-spike.md) | Prove the diff slot can alternate revdiff and the browser+viewer pair | — |

**T00 gates T05, and through it the whole of Phase 2.** The core question — can the pair be
built, parked as a unit and restored with its geometry intact — was answered *yes* at plan
review, on a headless mux. T00 makes that re-runnable and adds the four cases the one-off probe
did not reach. If any of those fails, it is a decision for the user, not a fallback for a
session to pick.

It also promotes the four probes already run during planning into `spikes/browse-mode/`, so
the numbers quoted in DESIGN §2.4 and §2.6 can be re-run rather than believed.

**At the end of Phase 0:** the architecture is confirmed under load, and the measurements live in
`spikes/` instead of a scratch directory.

## Phase 1 — The push, headless

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-open-model.md) | `cockpit-open-model.mjs` — the pure open/tab/tabswitch decision | — |
| [T02](tasks/T02-open-command.md) | `cockpit-open.mjs` — pane lookup, locked tab state, sending | T01 |
| [T03](tasks/T03-browse-verbs.md) | The broot verb layer, and micro/broot as prerequisites | T02 |

**At the end of Phase 1:** Enter on a file in a broot carrying the cockpit's verb file pushes it
into a micro that is *already running* — provided something put one in the diff slot by hand.
Nothing knows about modes yet, and a machine without micro or broot is refused at install time.

## Phase 2 — The daemon

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-fourth-mode.md) | `browse` as the fourth stop: launch both halves, publish, label, detect | — |
| [T05](tasks/T05-pair-park.md) | Park and restore the pair instead of killing it | T00, T04 |
| [T06](tasks/T06-heal-and-reap.md) | A quit half is reinstated; a reaped agent's pair is disposed | T05 |

**At the end of Phase 2:** `⌥]` reaches browse, both halves come and go with their tabs and tree
position, and the unhappy paths in DESIGN §2.n are covered. `spikes/cockpit-test/run.sh` is still
green.

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
| T00 | medium | Four promoted probes plus a pair-slot probe with four new cases; a RESULTS.md worth reading |
| T01 | light | One pure function and its table of cases |
| T02 | medium | Locking (reusing the agenda's), atomic writes, refusals, a stubbed `wezterm` |
| T03 | light | A five-line hjson, the `--conf` chain, two prerequisite rows |
| T04 | medium | Two panes launched into one slot, the focus rule, the strip, the footer, and the pane detection T06 would otherwise have carried |
| **T05** | **heavy** | A slot that has always held one pane per agent now holds a pair, parked as a unit |
| T06 | medium | Two independent heals plus the reap, all cooldown-guarded |
| T07 | light | Minutes of the user's time — but the session waits for it |

## Still open

*(Nothing. The `browse` command name, which the planning session left open, disappeared with the
command itself at plan review — the browser now arrives with the mode. DESIGN §8.)*
