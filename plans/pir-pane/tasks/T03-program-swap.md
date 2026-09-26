# T03 — program-swap

**Phase:** 2 · **Depends on:** T00 · **Weight:** heavy

## Goal

Teach the daemon that the fleet slot can hold one of two programs. It accepts `fleet-pir` and
`fleet-claude` only at a list screen, spawns the pir pane on first use through a relaunch loop,
swaps the two by the order T00 measured, and parks the one not shown. It moves every landmark
use of `panes.fleet` onto `panes.foot` and every anchor/focus use onto the pane in the slot, and
keeps the claude-only machinery quiet while pir is shown. Following pir's open run is T04; here
pir is treated as always at its list.

## Design sections this implements

DESIGN §2.2, §2.3, §2.7 (`focus-claude` only), §2.8, §2.9 (reconcile gate), §2.10, §3.2.

## Files

- `bin/cockpitd.mjs`
- `bin/cockpit-pir.sh` (new)
- `bin/cockpit-layout.sh` (delete `pir-dashboard.json` on rebuild, beside the `cmd` truncation)
- `spikes/cockpit-test/run.sh` (a `pir` stub on the stub PATH; new sections)

## Interface

```js
let fleetProgram = "claude";          // session-only
function slotFleetPane()              // panes.pir when fleetProgram === "pir", else panes.fleet
function cockpitTabId(table)          // now keyed on panes.foot
async function switchFleet(target)    // "claude" | "pir"; refuses unless fleetSwitchable()
function fleetSwitchable()            // claude: paneState().mode === "list"; pir: T04 decides,
                                      // here always true
// cmd verbs: "fleet-claude", "fleet-pir"
// terminals.json: fleet: { program: fleetProgram, switchable, available: PIR_BIN !== null }
// panes.json: pir: <pane id> once spawned
```

```sh
# bin/cockpit-pir.sh <pir-binary> <state-file>
# loop: PIR_DASHBOARD_STATE=<state-file> <pir-binary>; on 5 exits each under 2s,
# print why and wait for Enter, then loop again. Never exits.
```

The places that read `panes.fleet` today (from the survey; re-check with a grep): the tab
lookups at `cockpitd.mjs` `cockpitTabId`, `diffPaneFocused`, and the inline `tab_id` finds
near `showTerminal`, `showDiff`, the healers; the split anchors in `insertIntoSlot` and
`rebuildDiffSlot`; the focus hand-back at the ends of `showTerminal` and `showDiff`;
`focus-claude`; `injectReview`; `spawnAgent`; `paneState`.

## Tests

- [ ] `fleet-pir` at the fleet list: pir pane spawned with `cockpit-pir.sh`, claude pane
      parked, `terminals.json` says `program:"pir"`, `panes.json` has `pir`.
- [ ] `fleet-claude` back: claude pane restored into the slot, pir parked, not killed; a second
      `fleet-pir` restores the same pir pane without spawning.
- [ ] `fleet-pir` with an agent attached → refused, logged, nothing moves.
- [ ] `fleet-pir` when `pir` is not on PATH → refused; `available:false`.
- [ ] While pir is shown, changing the stubbed fleet text to an agent header does not attach
      (reconcile gated).
- [ ] While pir is shown, `focus-claude` activates nothing.
- [ ] `bb-review` while pir is shown → switches to claude first, then types `@repo …` + Enter
      into the claude pane; never into the pir pane.
- [ ] After swaps, terminal commands (`new`, `next`, `close-N`) and a diff attach still land in
      the cockpit tab and the right slots (landmark moved to `panes.foot`).
- [ ] `cockpit-pir.sh` with a stub that exits immediately stops after 5 and waits (run with a
      short timeout and closed stdin).
- [ ] Layout rebuild deletes `pir-dashboard.json`.

## Done when

- [ ] All new sections and the whole cockpit-test suite pass.
- [ ] `grep -n "panes.fleet" bin/cockpitd.mjs` leaves only uses that mean the claude pane itself.
- [ ] With pir never clicked, every existing cockpit-test section passes unchanged.

## End to end (the worker drives this)

- suite: `spikes/cockpit-test` (wezterm stubbed, real daemon) · the swap geometry itself was
  measured in T00
- [ ] footer verbs appended to `cmd` → panes swap as listed above
