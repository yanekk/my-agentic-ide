# T06 — Heal a quit viewer, reap a dead agent's

**Phase:** 2 · **Depends on:** T05 · **Weight:** medium

## Goal

The unhappy paths. You press `Ctrl+Q` in micro and the diff pane drops to a bare shell, which
reads as the cockpit having broken. An agent dies while its viewer sits parked, and the pane
and its state live on for the life of the window. Both already have answers for revdiff; this
task gives browse mode the same ones.

Recovery lands **before** the feature is handed to the user in T07, not after.

## Design sections this implements

DESIGN §2.n (the quit viewer, the racing heal, the reaped agent), §6 (recovery).

## Files

```
bin/cockpitd.mjs             healQuitDiff (or its browse-mode sibling), reapAgents
spikes/cockpit-test/run.sh   extended
```

## Interface

`healQuitDiff` currently watches the attached agent's diff pane and relaunches **revdiff** on
the same range the moment it drops to a shell. It must now relaunch whatever the agent's
**current mode** calls for — `micro -readonly true` in browse mode — and, when it reinstates a
viewer, **reset that agent's tab list**, because the tabs died with the process.

Guards that already exist and must keep applying:

- **The cooldown** (`DIFF_RELAUNCH_COOLDOWN_MS`). A starting micro looks like a shell for a
  moment, and relaunching into it would type the command into a live editor.
- **The custom-prompt suppression.** While the ASCII ref prompt owns the pane, nothing heals it.

Detection: WezTerm titles a micro pane **`micro`**, stable from one second — no lag, unlike
revdiff (FINDINGS). The check may use the title, but **should still tolerate a lag** rather
than assume none; the cost of being wrong is typing a command into a live editor.

Reaping: when an agent is reaped, **every** pane it owns is disposed — its revdiff, its viewer,
and its terminals — and its entry in `viewer-tabs.json` is dropped. Reaping still requires
**two consecutive misses**, unchanged: one failed `claude agents` read must not kill a shell
with someone's build running in it.

## Tests

- [ ] a browse-mode diff pane that drops to a shell is relaunched as `micro -readonly true`
- [ ] and that relaunch **resets** the agent's tab list
- [ ] an uncommitted-mode pane that drops to a shell still relaunches **revdiff**, unchanged
- [ ] no heal fires inside the cooldown window
- [ ] no heal fires while the custom prompt is open
- [ ] a **parked** viewer is never healed — it is not in the slot and is not supposed to be
- [ ] reaping an agent disposes its viewer pane as well as its revdiff and terminals
- [ ] reaping drops its `viewer-tabs.json` entry
- [ ] reaping still needs two consecutive misses; one miss disposes nothing
- [ ] reaping an agent whose viewer is **in the slot** leaves the slot in a valid state, not
      empty
- [ ] `panes.json.viewer` is cleared when the viewer it names is disposed

## Done when

- [ ] `spikes/cockpit-test/run.sh` green, covering every row above
- [ ] no orphaned pane or `viewer-tabs.json` entry survives a reap, asserted
- [ ] `spikes/browse-test/run.sh` still green
