Plan a left-arrow program picker for the cockpit's bottom-left (fleet) slot, so I can switch
between `claude agents` and pir from the keyboard instead of only by clicking the footer's
`Claude Agents | PIR` labels.

This reverses one decision in `plans/pir-pane/DESIGN.md` (§2.1 and §7, 2026-09-26: "switch by
footer click only, no key"). I have now decided to add a key; the click stays as it is. Every
other rule of that plan stands, in particular §2.2: switching is only allowed while the shown
program is on its list screen.

The look and feel was settled with a throwaway mock: open
`plans/pir-pane/prototype/fleet-selector-mock.html` and pick variant **A · List picker**. That is
the one I chose. B and C were the alternatives I turned down.

## What I decided

- **Plain left arrow (no modifier) opens the picker**, and only when all of these hold:
  - the focused pane is the fleet slot (`claude agents` or pir, whichever is shown);
  - no agent is attached (we are at the fleet list, not inside an agent);
  - the shown program is on its list screen (the same condition that makes the footer switch
    bright rather than dim, `fleet.switchable` in `terminals.json`);
  - for `claude agents`: its prompt box is **empty**. With text in the box, left arrow must
    reach claude untouched so it still moves the cursor. pir has no prompt box, so on pir's runs
    list left arrow always opens the picker.
  In every other case left arrow behaves exactly as it does today.
- **The picker replaces the slot's content** with a short list: `SWITCH PROGRAM`, then
  `Claude Agents` and `PIR`, with the program that is *not* currently shown already highlighted
  and the shown one marked `shown now`.
- **Keys in the picker:** ↑/↓ move the highlight; **Enter or → opens** the highlighted program
  (→ was my one change to the mock); Esc closes the picker and changes nothing. So switching is
  ← then →.
- Opening the program that is already shown just closes the picker.

## Still open. Ask me, one at a time

My lean is given for each; do not settle them silently.

1. **The status line under each entry** (the mock shows `3 agents · 1 needs you` and
   `2 runs · fleet-selector on T02`, made up). Claude's can probably come from
   `claude agents --json`. pir reports only its `view`/`run`/`worker` in `pir-dashboard.json`, so
   a richer PIR line would need pir to report more. Lean: Claude's line from data we already
   have, PIR's entry name-only, or both name-only for a first cut.
2. **← inside the picker.** Lean: does nothing.
3. **pir not installed** (`fleet.available` false). Lean: no picker at all, left arrow stays plain
   left arrow, the same as the footer hiding the switch.
4. **The footer key legend.** Should it mention `←` at the list? Lean: yes, only while the
   picker is reachable.

## Things to get right technically (check, don't assume)

- Where the decision is made. Left arrow goes to claude on *every* cursor move, so the check
  must not add visible lag or drop keys. A WezTerm `action_callback` in `wezterm/cockpit.lua`
  that decides locally and otherwise forwards the arrow is likely; a round trip through the
  daemon's `cmd` channel for every arrow press is likely too slow. Measure it.
- How "prompt box is empty" is detected. The daemon already reads the fleet pane's screen
  (`LIST_MARKER = "describe a task for a new session"` in `bin/cockpitd.mjs` is the placeholder
  text of an empty box). Check whether that placeholder is reliably present exactly when the box
  is empty, and what happens when a Claude update changes it. The failure we can live with is
  "left arrow stays plain left arrow"; the one we cannot is swallowing a cursor move.
- Whether `claude agents`' list screen or pir's runs list already uses left arrow for anything
  that this would take away.
- How the picker is drawn: a small script in the slot, like `bin/cockpit-custom-prompt.mjs`
  for the custom diff ref, handing its choice back through `cmd` as the existing `fleet-claude` /
  `fleet-pir` verbs. While it is open the daemon's healers must leave that pane alone, the way
  `customPromptOpen` guards the custom prompt. Parking `claude agents`/pir behind it must not
  restart them.
- Re-read the CLAUDE.md "measured" rows on the fleet slot (it is parkable, `panes.foot` is the
  landmark), on typing into panes, and on mouse handling before designing the swap.

Testing: the integration suite (`spikes/cockpit-test/`) plus the pir-pane suite. Whether the key
feels right on the real window is a hands-on check with me at the end.
