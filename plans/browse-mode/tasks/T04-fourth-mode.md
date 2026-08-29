# T04 — `browse` as the fourth mode

**Phase:** 2 · **Depends on:** — · **Weight:** medium

## Goal

Teach the daemon that the diff slot has four modes rather than three, so `⌥[`/`⌥]` reach
`browse`, **both halves** of the browse pane are launched into the slot, and the strip and footer
say where you are. This task makes the mode **reachable and visible**; T05 makes it **park**.

## Design sections this implements

DESIGN §2.1 (the fourth stop, and `⌥[`/`⌥]` from either half), §2.2 (the viewer), §2.3 (the
browser and the split ratio), §2.7 (what the strip shows), §3.4 (publishing the viewer keys).

## Files

```
bin/cockpitd.mjs          DIFF_MODES, diffCommand(), browse launch, diffPaneStatus(),
                          diffPaneFocused(), publishPanes({viewer…})
bin/cockpit-strip.mjs     DIFF_ORDER, DIFF_MODE_LABELS
spikes/cockpit-test/run.sh   extended
```

## Browse mode launches TWO panes, not one

```
┌──────────────────────┬───────────────────────────────┐
│  broot  (47 cols)    │  micro -readonly true  (72)   │   the diff slot
└──────────────────────┴───────────────────────────────┘
```

The browser is split into the slot first (it is the one that inherits the slot's geometry — see
T05's opposite-order rule), then the viewer is split off its right at **`--percent 60`**, which
on a 120-column window gives broot 47 columns and micro 72. Measured; 47 is the width broot was
already validated usable at. **The browser gets focus**, because that is where the gesture
continues.

Both are spawned through `/usr/bin/env` with `PATH` and `COCKPIT_REPO` **named on the command
line** — a `wezterm cli split-pane` inherits no environment (`CLAUDE.md`), and broot's Enter verb
has to be able to find `cockpit-open`. broot is launched with the `--conf` chain T03 defines.

The viewer takes no `reviewFile` and no `ref`: browse mode produces no annotations, so nothing is
watched and nothing can be flushed.

## `⌥[`/`⌥]` must work from BOTH halves

`diffPaneFocused()` decides whether those keys cycle diff modes or terminals, by comparing the
tab's active pane against *the* diff pane. In browse mode there are two, and **either counts**.
Otherwise the keys do nothing while the browser holds focus — which is exactly where focus starts
— and the only way out of browse mode is to click the viewer first. That is a trap, not a mode.

## `diffPaneStatus` must learn what the browse panes look like — in THIS task, not T06

**Measured during the plan review, on a headless mux:** a running `micro` shows **zero** lines
beginning with `│` (`FRAMED_LINES`/`FRAMED_ENOUGH` need ≥5) and its pane title is `micro`, which
does not match `/revdiff/`. broot likewise draws no `│` frame. So today `diffPaneStatus` returns
**`"shell"`** for both halves of a perfectly healthy browse pane — and `healQuitDiff` runs on a
1 s tick with a 3 s cooldown.

The moment browse mode is reachable, that healer will type a whole command line into the live
viewer and a live browser, once a second. The fix therefore cannot wait for T06: **this task
teaches `diffPaneStatus` to report both browse-mode panes as `"running"`**, and T06 keeps the
rest of the healing (relaunching the right thing in the right half, resetting the tab list, the
reap).

Detection uses the pane titles `micro` and `broot`, which FINDINGS records as stable from t=1 s
with no lag — unlike revdiff, whose title lags and is why the framed-screen signal exists.
**Still tolerate a lag** rather than assume none: the cost of being wrong is typing into a live
editor, so a pane inside the launch cooldown must be left alone regardless of what its title
says.

## Interface

```js
const DIFF_MODES = ["uncommitted", "lastcommit", "custom", "browse"];
```

For the three revdiff modes `diffCommand(reviewFile, mode, ref)` is unchanged. `browse` is not a
command but a **pair**, so it does not go through `diffCommand` at all:

```sh
# left, first into the slot, then focused
/usr/bin/env "PATH=$PATH" "COCKPIT_REPO=$REPO" broot --conf <chain> <worktree>
# right, split off the left at --percent 60
/usr/bin/env "PATH=$PATH" "COCKPIT_REPO=$REPO" micro -readonly true
```

Both start in the agent's worktree. micro takes **no file argument** — the first push replaces
its `No name` buffer via `open` (DESIGN §2.2). Neither takes a `reviewFile` or a `ref`.

`panes.json` gains **three keys, always written together** (DESIGN §3.4):

```json
{ "viewer": 7, "viewerAgent": "<jobId>", "viewerRoot": "/abs/path/to/worktree" }
{ "viewer": null, "viewerAgent": null, "viewerRoot": null }   // any other time
```

`viewerAgent` is the agent's **jobId**, not the display name `terminals.json` carries;
`viewerRoot` is the agent's **worktree** — the directory micro is launched in — not
`panes.json.repo`, which holds the projects root. DESIGN §3.4 has the reasoning for both, and
T02 refuses if any of the three is missing.

Published through the existing `publishPanes()`, so all three are written atomically with the
rest and a reader never sees a pane id without the agent and root that go with it. They must be
cleared on detach, on a mode change away from browse, and when the agent is reaped — a stale id
points at a pane that is now somebody else's.

Cycling **into** `browse` must not fire the custom-ref prompt: that is `custom`'s behaviour and
is keyed on the transition into `custom` specifically.

## Tests

- [ ] `⌥]` from `custom` lands on `browse`; `⌥]` from `browse` wraps to `uncommitted`
- [ ] `⌥[` from `browse` lands on `custom` **and fires the custom prompt**, because that is a
      transition *into* custom
- [ ] `⌥[` from `uncommitted` lands on `browse` and fires **no** prompt
- [ ] the mode is per agent: putting agent A in `browse` leaves agent B in `uncommitted`
- [ ] a new agent starts at `uncommitted`, never in `browse`
- [ ] entering browse launches **two** panes: broot on the left with T03's `--conf` chain, micro
      on the right as `micro -readonly true` with **no file argument**, both in the agent's
      worktree
- [ ] the browser is split into the slot **first** and the viewer off its right at
      `--percent 60`; on a 120-column slot that is 47 and 72
- [ ] both are spawned through `/usr/bin/env` with `PATH` and `COCKPIT_REPO` named explicitly
- [ ] the **browser** holds focus after entering browse mode, not the viewer
- [ ] `panes.json.viewer`, `.viewerAgent` and `.viewerRoot` are all set on entering browse and
      all **cleared** on leaving it — never one without the others
- [ ] `viewerAgent` is the jobId, not the display name; `viewerRoot` is the agent's worktree,
      not `panes.json.repo`
- [ ] all three are cleared on detach
- [ ] `⌥[`/`⌥]` while a **terminal** holds focus still cycle terminals, not modes
- [ ] `⌥[`/`⌥]` cycle **modes** while the *browser* half holds focus — the trap case
- [ ] `⌥[`/`⌥]` cycle **modes** while the *viewer* half holds focus
- [ ] `⌥t`/`⌥w` still act on terminals from either half, unchanged
- [ ] `DIFF_MODE_LABELS` gains `browse: "Browse"`, so the footer highlights **Browse** in browse
      mode — not `Uncommitted Changes`, which is what the current fallback would do
- [ ] `DIFF_ORDER` gains `"browse"`, so the label is drawn fourth and has a click hit-zone
- [ ] a click on the `Browse` label appends `diff-browse` to the `cmd` channel, and the daemon
      accepts it (`DIFF_MODES.includes`) and switches
- [ ] clicking `Browse` while already in browse is a no-op, like the other labels
- [ ] the three existing labels keep their columns and their click zones
- [ ] no annotation watch, review file or reflog watch is created for a browse-mode pane
- [ ] a **running viewer reports `"running"`**, not `"shell"` — the whole point of the
      `diffPaneStatus` change above
- [ ] a **running browser reports `"running"`** too
- [ ] `healQuitDiff` therefore does **not** fire at either healthy half, even well past the
      cooldown; nothing is sent to either
- [ ] a half really sitting at a shell (that program was quit) still reports `"shell"`
- [ ] the revdiff modes' `"running"`/`"editing"`/`"shell"` answers are unchanged

## Done when

- [ ] `spikes/cockpit-test/run.sh` green, covering every row above
- [ ] `panes.json` carries a correct `viewer` in every state, asserted rather than assumed
- [ ] `spikes/browse-test/run.sh` still green
