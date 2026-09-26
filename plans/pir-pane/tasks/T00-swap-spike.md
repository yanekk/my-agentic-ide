# T00 — swap-spike

**Phase:** 0 · **Depends on:** — · **Weight:** medium

## Goal

Prove on a real headless `wezterm-mux-server` that the bottom-left fleet slot can swap between
two programs the way the diff slot swaps revdiffs: the incoming pane gets the whole slot, the
terminal and strip beside it keep their widths, both programs survive being parked and return
redrawn, and `panes.foot` stays in the cockpit tab through all of it so it can serve as the
landmark (DESIGN §2.3, §2.10). Throwaway: the script is deleted and the answers go to
FINDINGS.md.

## Design sections this implements

DESIGN §2.3, §2.10, §5.2 (headless mux seatbelt).

## Files

- `spikes/pir-pane-swap/probe.sh` (created, deleted before the task closes; its method follows
  `spikes/pane-swap/probe.sh`)
- `plans/pir-pane/FINDINGS.md` (rows appended)

## Interface

The answers T03 builds on, each recorded as a FINDINGS row:

```
swap in:  split-pane --{left|top|…} --percent N --pane-id <fleet> --move-pane-id <pir>  → sizes
          then move-pane-to-new-tab <fleet>                                             → sizes
swap out: the mirror image                                                                → sizes
landmark: tab_id of panes.foot before/after each step
redraw:   pir's screen text (get-text) after park + return matches its screen before
first spawn: split-pane … -- /usr/bin/env PIR_DASHBOARD_STATE=… pir  → sizes
```

## Tests

- [ ] Layout mimicking the cockpit (diff top 42%, bottom row fleet | terminal | strip, footer 1
      row) at 120×40 and at 80×24.
- [ ] Swap fleet → pir (first spawn) and record every pane's size; fleet slot width unchanged,
      terminal and strip unchanged.
- [ ] Swap pir → fleet (both parked in turn) and back again, three round trips; sizes stable.
- [ ] `get-text` of the pir pane after a return shows its runs list, not a blank or torn frame
      (use `PIR_HOME` pointed at a scratch dir so the list is empty and deterministic).
- [ ] `panes.foot`'s `tab_id` equals the cockpit tab after every step.
- [ ] A pane running `claude agents` stand-in (any TUI, e.g. `less`) keeps its screen across a park.

## Done when

- [ ] FINDINGS.md has a row per interface line above, with measured sizes and the wezterm build.
- [ ] If any answer contradicts DESIGN §2.3 or §2.10, the task stops and brings it to the person.
- [ ] The probe script is deleted.
