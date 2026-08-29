# T06 — Heal a quit half, reap a dead agent's pair

**Phase:** 2 · **Depends on:** T05 · **Weight:** medium

## Goal

The unhappy paths. You press `Ctrl+Q` in micro — or quit broot — and **half** the top pane drops
to a bare shell, which reads as the cockpit having broken. An agent dies while its pair sits
parked, and two panes and their state live on for the life of the window. Both already have
answers for revdiff; this task gives browse mode the same ones, **per half**.

Recovery lands **before** the feature is handed to the user in T07, not after.

## Design sections this implements

DESIGN §2.n (the quit viewer, the racing heal, the reaped agent), §6 (recovery).

## Files

```
bin/cockpitd.mjs             healQuitDiff (or its browse-mode sibling), reapAgents
spikes/cockpit-test/run.sh   extended
```

## Interface

`healQuitDiff` currently watches the attached agent's **one** diff pane and relaunches revdiff on
the same range the moment it drops to a shell. In browse mode there are **two** panes and they
fail independently, so the healer checks each and relaunches only the one that died:

| Half that dropped to a shell | Relaunch | And |
|---|---|---|
| the viewer (micro) | `micro -readonly true` in that half | **reset that agent's tab list** — the tabs died with the process |
| the browser (broot) | broot with T03's `--conf` chain, in that half | nothing else; the viewer and its tabs are untouched |
| both | each, by the rules above | neither heal may assume the other half is alive |

**Never rebuild the pair to fix one half.** Killing and re-splitting both would throw away the
tabs (or the tree position) of the half that was perfectly fine, which is the opposite of what
healing is for.

Guards that already exist and must keep applying:

- **The cooldown** (`DIFF_RELAUNCH_COOLDOWN_MS`). A starting micro or broot looks like a shell for
  a moment, and relaunching into it would type the command into a live program. The cooldown is
  **per pane**, not per agent — healing the browser must not silence the viewer's healer.
- **The custom-prompt suppression.** While the ASCII ref prompt owns the pane, nothing heals it.
  (The prompt only ever appears in a revdiff-mode slot, never in browse, but the guard is cheap
  and its absence would be a landmine.)

**Detection already landed in T04** and is not this task's job. It had to: both halves read as a
bare `"shell"` to the stock `diffPaneStatus` (0 framed lines; titles `micro` and `broot`), so the
healer would have fought a healthy pair for the whole of T04 and T05. See T04. This task assumes
`diffPaneStatus` is already truthful and builds the *response* on top of it.

Reaping: when an agent is reaped, **every** pane it owns is disposed — its revdiff, **both**
halves of its browse pair, and its terminals — and its entry in `viewer-tabs.json` is dropped.
Reaping still requires **two consecutive misses**, unchanged: one failed `claude agents` read
must not kill a shell with someone's build running in it.

## Tests

- [ ] a quit **viewer** is relaunched as `micro -readonly true` in its own half
- [ ] and that relaunch **resets** the agent's tab list
- [ ] a quit **browser** is relaunched as broot in its own half, with the `--conf` chain
- [ ] healing the browser leaves the viewer's pane id **and its tab list** untouched
- [ ] healing the viewer leaves the browser's pane id untouched
- [ ] both halves quit at once → both are relaunched, and the split is still 47/72
- [ ] **no heal ever kills the surviving half** or re-splits the slot — asserted, not assumed
- [ ] an uncommitted-mode pane that drops to a shell still relaunches **revdiff**, unchanged
- [ ] no heal fires inside the cooldown window, and the cooldown is **per pane**: healing one
      half does not suppress the other half's heal
- [ ] no heal fires while the custom prompt is open
- [ ] a **parked** half is never healed — it is not in the slot and is not supposed to be
- [ ] reaping an agent disposes **both** halves as well as its revdiff and terminals
- [ ] reaping drops its `viewer-tabs.json` entry
- [ ] reaping still needs two consecutive misses; one miss disposes nothing
- [ ] reaping an agent whose **pair is in the slot** leaves the slot in a valid state, not empty
      and not half-occupied
- [ ] `panes.json.viewer`, `.viewerAgent` and `.viewerRoot` are all cleared when the viewer they
      name is disposed

## Done when

- [ ] `spikes/cockpit-test/run.sh` green, covering every row above
- [ ] no orphaned pane or `viewer-tabs.json` entry survives a reap, asserted
- [ ] `spikes/browse-test/run.sh` still green
