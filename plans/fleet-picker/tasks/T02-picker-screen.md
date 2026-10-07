# T02 — picker-screen

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The picker that stands in the fleet slot while the person chooses: it draws DESIGN §2.3, reads
the keys of §2.4 from its own raw tty, hands back exactly one verb on the cmd channel, and never
lets its pane close (§2.7). The decisions live in a pure model so every key and every size is
tested in milliseconds; the process around it is thin.

## Design sections this implements

DESIGN §2.3, §2.4, §2.7, §3.1.

## Files

- `bin/cockpit-fleet-picker-model.mjs` (new, pure)
- `bin/cockpit-fleet-picker.mjs` (new)
- `bin/cockpit-fleet-picker.sh` (new)
- `spikes/fleet-picker-test/run.sh` (new)

## Interface

```js
// bin/cockpit-fleet-picker-model.mjs
export const ORDER = ["claude", "pir"];
export const NAMES = { claude: "Claude Agents", pir: "PIR" };
export function initialState(shown)        // → { shown, sel }  sel = the other program
export function decodeKey(chunk)           // string → "up"|"down"|"enter"|"right"|"left"|"escape"|"ctrl-c"|null
export function reduce(state, key)         // → { state } | { done: "claude" | "pir" | "cancel" }
export function render(state, cols, rows)  // → string[]: exactly `rows` lines, each ≤ cols visible
```

```
bin/cockpit-fleet-picker.mjs <cmd-file> <shown>
  raw mode; render on start and on SIGWINCH; on done append `fleet-<prog>` or `picker-cancel`
  to <cmd-file> and exit 0
bin/cockpit-fleet-picker.sh <cmd-file> <shown>
  node cockpit-fleet-picker.mjs "$@" || echo picker-cancel >> "$1"; then wait for ever
  (the daemon kills the pane), so the pane never closes on its own
```

The cmd file is an argument, not read from the environment, because the pane is spawned from the
mux server and inherits nothing (CLAUDE.md, "Terminals are spawned through `/usr/bin/env`").

## Tests

- [ ] `initialState("claude").sel === "pir"` and the reverse.
- [ ] decodeKey: CSI and SS3 forms of ↑ ↓ → ←; `\r` and `\n` as enter; lone `\x1b` as escape;
      `\x03` as ctrl-c; a mouse report, a printable and an unknown sequence as null.
- [ ] reduce: ↑/↓ toggle `sel`; enter and right give `done: sel`; escape and ctrl-c give cancel;
      left and null leave the state unchanged.
- [ ] render: the lines of §2.3 in order, `▸` on `sel`, `shown now` on `shown`, hint on the last
      line; exactly `rows` lines; no line wider than `cols` at 59×22, 39×12 and 20×6.
- [ ] purity grep on the model (DESIGN §3.1).
- [ ] the process, driven under a pty in the suite (python3 `pty` or `script`): ↓ Enter appends
      exactly one `fleet-…` line; Esc appends one `picker-cancel`; Ctrl+C appends one
      `picker-cancel`; killing node with SIGTERM makes the wrapper append one `picker-cancel` and
      stay alive.

## Done when

- [ ] `spikes/fleet-picker-test/run.sh` passes with the model and process checks.
- [ ] Every exit path of the picker appends exactly one verb.
- [ ] The wrapper never exits on its own.

## End to end (the worker drives this)

- suite: `spikes/fleet-picker-test/run.sh` (a pty around the real process); the in-cockpit flow
  is T04's · sizes: 59×22, 39×12
- [ ] ↓ then → under the pty → one `fleet-claude` line in the cmd file when `pir` was shown
- [ ] a resize of the pty → the frame is redrawn at the new size with no line over the width
