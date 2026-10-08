# T03 — daemon-picker

**Phase:** 2 · **Depends on:** T00, T02 · **Weight:** heavy

## Goal

The daemon side of the picker: publish the armed block the ← binding reads, open the picker by
standing its pane in front of the shown program, and close it onto the chosen one, reusing the
pir-pane swap so there is one switching mechanism. Keep every other path (pir spawn on first use,
pir follow, `spawnAgent`, the healers, the terminal gestures) correct while the picker is open.

## Design sections this implements

DESIGN §2.5–§2.9, §3.2, §3.5; pir-pane DESIGN §2.2, §2.3, §2.8–§2.10.

## Files

- `bin/cockpitd.mjs`
- `spikes/cockpit-test/run.sh` (new sections, and their `chain` rows)

## Interface

```js
// in-memory: null, or the open picker
let pickerOpen = null;          // { pane: number, shown: "claude" | "pir" }

// verbs on the cmd channel
"picker"                         // openPicker()
"picker-cancel"                  // closePicker(pickerOpen.shown); ignored when no picker is open
"fleet-claude" | "fleet-pir"     // closePicker(target) while open; switchFleet(target) otherwise

function slotFleetPane()         // pickerOpen ? pickerOpen.pane : (as today)
async function openPicker()      // under the reconcile lock; checks of DESIGN §2.8
async function closePicker(target)  // under the lock; spawns pir first time if target is pir
```

`terminals.json` `fleet`: add `pickerOpen` and `picker` (DESIGN §3.5); `switchable` is false while
open. `panes.json`: `picker` while open, removed on close.

Open: `split-pane --left --percent 50 --pane-id <slot> -- <cockpitEnv()> cockpit-fleet-picker.sh
<CMD_FILE> <shown>`, park the slot pane, `activate-pane` the picker. Close: split the target's pane
(or a new pir pane) into the picker pane the same way, `kill-pane` the picker, activate the target.
Factor the shared split-into-outgoing step out of `switchFleet` rather than copying it.

If T00 measured the 200ms poll as the bulk of the open time, add a directory watch on `cmd`'s
folder that calls the tail's `read()`, keeping the poll as the backstop (CLAUDE.md, "Watch the
directory, never the file").

## Tests

- [ ] armed block: present with claude at its list, pir installed, nothing attached; `null` when
      attached, when pir is absent, when not switchable, while the picker is open; `pane` follows the shown program.
- [ ] `picker` opens: one split naming `cockpit-fleet-picker.sh` with the cmd file and the shown
      program, the program's pane parked (not killed), focus on the picker, `panes.json` has `picker`.
- [ ] `picker` refused, with a log line and no wezterm call, when attached, pir absent, already
      open, or not switchable.
- [ ] `fleet-pir` while open over claude: pir spawned on first use into the picker pane, picker
      killed, `fleetProgram` is pir; a second round restores the parked pir pane instead of spawning.
- [ ] `fleet-claude` while open over claude, and `picker-cancel`: claude split back, picker
      killed, `fleetProgram` unchanged, nothing restarted.
- [ ] `picker-cancel` with no picker open: ignored.
- [ ] while open: `switchable` false in `terminals.json`; reconcile reads no pane; `⌥t` splits off
      the picker pane; a `bb-review` closes the picker onto claude before `spawnAgent` types.
- [ ] the picker pane disappears from the stub's pane list while open: the open state is cleared
      and logged on the next tick.
- [ ] the existing pir-pane sections pass unchanged.

## Done when

- [ ] The new cockpit-test sections pass and the full suite prints `ALL PASS`.
- [ ] `switchFleet` and the picker share one swap helper.
- [ ] Every guard of DESIGN §2.6 has a test.

## End to end (the worker drives this)

- suite: `spikes/cockpit-test/run.sh` (stubbed wezterm, real daemon, real strip renderer); the
  real-mux flow is T04's
- [ ] `picker` then `fleet-pir` → stub log shows the open split, the park, the close split, the
      kill, and the footer reads `PIR` shown
