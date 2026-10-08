---
setup: none
test:
  - [ ! -e spikes/fleet-picker-keys-test/run.sh ] || bash spikes/fleet-picker-keys-test/run.sh
  - [ ! -e spikes/fleet-picker-test/run.sh ] || bash spikes/fleet-picker-test/run.sh
  - bash spikes/pir-pane-test/run.sh
  - bash spikes/cockpit-test/run.sh
---

# Left-arrow program picker for the fleet slot — Design

## 1. Purpose

The cockpit's bottom-left (fleet) slot shows either `claude agents` or the pir dashboard, and
today the only way to switch is clicking the footer's `Claude Agents | PIR` labels
(`plans/pir-pane/DESIGN.md` §2.1). This plan adds a keyboard route: plain ← at the list opens a
small picker in the slot, and Enter or → opens the chosen program. The click stays exactly as it
is. Everything else in the pir-pane plan stands, in particular its §2.2: switching only happens
while the shown program is on its list screen.

### Success criteria

- At the fleet list, with the slot focused and the program's box empty, ← then → shows the other
  program, in the state it was left in, with neither program restarted.
- With text in either program's box, inside an agent or a pir run, or on any screen other than
  the list, ← reaches the program exactly as before.
- ← in every other pane (terminals, revdiff, broot, micro, the custom prompt) behaves exactly as
  before, with no perceptible lag.

### Stance

A keypress is decided where it happens, in the order it happens. The ← check runs inside WezTerm
at the moment of the press and either forwards the key at once or hands one verb to the daemon. A
check that round-trips every ← through the daemon could deliver a forwarded ← after keys typed
later, which reorders an edit; that is the one failure this design will not risk.

---

## 2. Behaviour specification

### 2.1 When ← opens the picker

Plain ← (no modifier) opens the picker only when all of these hold at the moment of the press:

1. the focused pane is the pane in the fleet slot (`claude agents` or pir, whichever is shown);
2. nothing is attached (no agent, no `pir.` key);
3. pir is installed (`fleet.available`);
4. the shown program is at its list with switching allowed (`fleet.switchable`, the condition
   that draws the footer switch bright);
5. the shown program's box is empty, read from its screen at the press (§2.2).

Conditions 1–4 come from the daemon as one armed block in `terminals.json` (§3.5). Condition 5
cannot: the box changes on every keystroke and the daemon polls every 800ms, so only the screen
at the press is current enough. In every other case ← is forwarded to the pane unchanged.

With pir not installed there is no picker at all (person, 2026-10-07), matching the footer, which
hides the switch then: a picker with one usable entry is noise.

### 2.2 "The box is empty", per program

Both programs are read from the visible screen of the focused pane (`pane:get_lines_as_text`):

- `claude agents`: a line that is exactly `❯ describe a task for a new session` after trailing
  blanks are trimmed. Measured on Claude Code 2.1.291 (FINDINGS 2026-10-07): the placeholder is
  shown exactly when the box is empty, disappears on the first character, returns when the box
  is cleared, survives a typed leading space (Claude drops it), and disappears on a lone line
  break. It contains `LIST_MARKER` (`describe a task for a new session`) from `cockpitd.mjs`; the
  fleet-picker-keys suite asserts it does.
- pir: a line starting `↑↓ move · ↵ open`, the key hint pir draws only on its runs list with a
  bare box (`@` or empty). Measured on the installed pir (FINDINGS 2026-10-07): with text in the
  box it reads `↵ start planning · …`, and the pairing screen (Ctrl+P, where ← means back) does
  not draw it even though pir reports `view: list` there.

Reading pir's screen departs from the pir-pane stance ("the cockpit never scrapes pir's screen").
The person chose it (2026-10-07) over a pir change, because that stance is about locating folders
to follow, where a wrong read attaches the wrong diff, while here a wrong read can only fail
closed. If either program changes its wording the picker stops opening on that program and ←
stays plain ←, and nothing is lost: ← on an empty box is a no-op in both (measured, §2.9). The
string is never loosened to a partial match to "fix" that, since a looser match is what could
take a cursor move.

### 2.3 The picker

It replaces the slot's content, drawn like variant A of the approved mock
(`plans/pir-pane/prototype/fleet-selector-mock.html`):

```

   SWITCH PROGRAM
   ────────────────────────────────────────

     Claude Agents             shown now

   ▸ PIR


   ↑↓ choose · enter or → open · esc back
```

The entries are names only (person, 2026-10-07): no status line under either, because pir
reports nothing richer than its view and a line on one entry only would look broken. The order
is fixed, `Claude Agents` then `PIR` as in the mock; the drawing above is with claude shown, so
the highlight `▸` starts on PIR. The shown program carries `shown now`. The hint line sits at
the bottom of the pane. At the smallest slot (39×12 at an 80×24 window) the rule shortens to fit
and nothing wraps.

### 2.4 Keys in the picker

| Key | Effect |
|---|---|
| ↑ / ↓ | move the highlight (two entries, so either toggles; no wrap needed) |
| Enter, → | open the highlighted program; if it is the shown one, just close |
| Esc, Ctrl+C | close, change nothing |
| ← | nothing (person, 2026-10-07) |
| anything else | nothing |

Arrows are accepted in both CSI (`\x1b[A`) and SS3 (`\x1bOA`) forms, because WezTerm encodes
them per the pane's cursor-key mode. A lone `\x1b` in one read is Esc. Mouse input is ignored:
the picker is keyboard-only for now (person, 2026-10-07).

### 2.5 Both programs keep running

Opening the picker parks the shown program the way the pir-pane swap does (split the incoming
pane into the outgoing one at 50%, then `move-pane-to-new-tab` the outgoing), so neither program
is restarted and each returns with its scroll, selection and box intact. Closing splits the
chosen program's pane into the picker pane and kills the picker pane. The picker is spawned fresh
on every open, so it always starts with the other program highlighted and holds no state.

### 2.6 While the picker is open

- The footer's `Claude Agents | PIR` switch is drawn dim and ignores clicks (`switchable: false`),
  because the picker already is the switch (person, 2026-10-07).
- A BitBucket Review/Address click closes the picker onto `claude agents` and then spawns, as it
  does from pir today (pir-pane §2.8). `spawnAgent` types into `panes.fleet`, and a parked pane
  takes keystrokes as readily as a visible one, so the picker must be closed first.
- `reconcile()` does nothing: the shown program is parked and cannot change, the same reason the
  claude poll is gated while pir is shown (pir-pane §2.9).
- Focus moved to another pane leaves the picker open until the person returns to it.
- A window resize redraws the picker to the new size.
- `⌥t`/`⌥[`/`⌥]`/`⌥w` keep working on the terminals beside it; their anchors use
  `slotFleetPane()`, which names the picker pane while it is open.

### 2.7 The picker always answers

The picker hands back exactly one verb: `fleet-claude`, `fleet-pir` or `picker-cancel`. Ctrl+C
arrives as a byte in raw mode and is a cancel. The picker runs under a wrapper that appends
`picker-cancel` if node exits non-zero (a crash, a signal), and then keeps the pane alive until
the daemon kills it, because a pane that exits closes and collapses the slot, which only a
rebuild can restore (the same limit as a dead pir pane, pir-pane FINDINGS 2026-09-27). The wrapper
appends nothing after a clean exit, so a choice is never followed by a cancel that would race it.

### 2.8 The daemon's own checks

On `picker` the daemon checks again under the reconcile lock: pir installed, nothing attached,
no picker already open, `fleetSwitchableNow`, and the shown pane alive. It does not re-read the
box: by the time the verb is read (up to 200ms later) keys typed after the ← may have filled it,
and refusing then would drop a press that was correctly decided. A refusal is a log line; the ←
is not replayed, since replaying it after later keys is the reordering §1 rules out.

### 2.9 The unhappy paths

- The daemon is not running: the armed block in `terminals.json` is stale, so ← on an empty box
  appends a verb nobody reads. Nothing is lost, because ← on an empty box does nothing in either
  program.
- A character typed less than one redraw before ←: the screen still shows the placeholder and
  the picker opens, with the character in the parked program's box. T00 measures Claude's echo
  time so the size of this window is known.
- Keys pressed after ← but before the picker pane takes focus (the cmd tail's up-to-200ms poll
  plus the swap) reach the program behind it: a fast ← → leaves the picker up, a fast ← Enter may
  open the selected agent row, which reconcile follows once the picker closes. Accepted (person,
  2026-10-07); T00 measures the gap and T03 shortens it with a directory watch if the poll
  dominates. No key is held back, since that would be a second key interceptor.
- `terminals.json` missing, unreadable or without `fleet.picker`, or any error in the callback:
  ← is forwarded. The callback is wrapped in `pcall`; a broken check must never break ←.
- The picker pane is killed by hand while open: the daemon notices on its next tick, clears the
  open state and logs it. The parked program stays parked until a rebuild (known limit, §2.7).
- A rebuild never starts with the picker open: the state is in memory only.

---

## 3. Architecture

### 3.1 The boundary

```
wezterm/fleet-picker.lua           pure: decide(paneId, terminals, screenText) → "open"|"pass"
wezterm/cockpit.lua                the ← binding: reads terminals.json and the screen, calls
                                   decide, forwards SendKey or appends `picker` to cmd
bin/cockpit-fleet-picker-model.mjs pure: initial state, key decoding, reduce, render
bin/cockpit-fleet-picker.mjs       the picker process: raw tty, SIGWINCH, the hand-back
bin/cockpit-fleet-picker.sh        the wrapper of §2.7
bin/cockpitd.mjs                   open/close, the swap, the armed block, the guards of §2.6
```

`fleet-picker.lua` takes everything as arguments and touches no `wezterm` API, file or clock;
the fleet-picker-keys suite greps it for `io.`, `os.`, `wezterm.` and `require`. The JS model is
grepped for `node:fs`, `node:child_process`, `fetch(`, `Date.now(`, `new Date()` and
`process.`, as `cockpit-pir-model.mjs` is. If either grep fails, the fix is to move the code
into the shell side, never to relax the grep. Both pure halves are tested in milliseconds; the
daemon side needs the ~2-minute stubbed suite and the real-mux drill.

### 3.2 Modules

- `wezterm/fleet-picker.lua` (new): `decide`, and the two marker strings.
- `wezterm/cockpit.lua` (extended): loads the module from the checkout it found the layout
  script in; binds `LeftArrow` with no modifier. If the module cannot be loaded the binding is
  not added, so ← stays WezTerm's default.
- `bin/cockpit-fleet-picker-model.mjs`, `bin/cockpit-fleet-picker.mjs`,
  `bin/cockpit-fleet-picker.sh` (new): §2.3, §2.4, §2.7.
- `bin/cockpitd.mjs` (extended): verbs `picker` and `picker-cancel`, `fleet-claude`/`fleet-pir`
  while open, the generalised swap, `slotFleetPane()`, the armed block, the guards of §2.6.

### 3.3 The decision function

```lua
decide(pane_id, terms, text) -> "open" | "pass"
-- terms: the parsed terminals.json table, or nil
-- "open" iff terms.fleet.picker is a table, pane_id == terms.fleet.picker.pane, and
-- text has the empty-box line for terms.fleet.picker.program (§2.2)
```

### 3.4 Data flow

```
← in WezTerm GUI ──▶ cockpit.lua callback ── reads terminals.json + pane screen
                        │ decide = pass             │ decide = open
                        ▼                           ▼
              SendKey LeftArrow to pane      append `picker` to cmd
                                                    │ (200ms tail)
                                                    ▼
                         daemon: openPicker ─ split picker pane into slot, park program
                                                    │
                      picker: ↑↓ Enter → Esc ──▶ cmd: fleet-claude | fleet-pir | picker-cancel
                                                    ▼
                         daemon: closePicker ─ split chosen program into picker pane, kill it
                                                    ▼
                                    terminals.json { fleet: {…, picker, pickerOpen} }
```

### 3.5 Storage

`terminals.json`'s `fleet` block gains two fields, written by the daemon as today:

```json
"fleet": { "program": "claude", "switchable": true, "available": true,
           "pickerOpen": false, "picker": { "pane": 20, "program": "claude" } }
```

- `picker` is non-null only when §2.1's conditions 2–4 hold and no picker is open; `pane` is
  `slotFleetPane()`. It is `null` otherwise. An older daemon writes neither field, which reads
  as not armed, so ← stays plain.
- `switchable` is false while `pickerOpen` (§2.6).

`panes.json` gains `picker` while one is open. Nothing new is persisted.

---

## 4. Testing

- `spikes/fleet-picker-keys-test/run.sh` (new, T01): `decide` exhaustively, run inside
  WezTerm's own Lua by `wezterm --config-file <harness> show-keys` (no other Lua on this machine,
  measured: 45ms a run); that `wezterm/cockpit.lua` loads with a scratch `HOME` and binds
  `LeftArrow`; the Lua purity grep; the marker-equals-`LIST_MARKER` check.
- `spikes/fleet-picker-test/run.sh` (new, T02): the picker model, its purity grep, and the
  picker process under a pty. Two suites rather than one because T01 and T02 can be built at
  the same time, and one shared new file would collide.
- `spikes/cockpit-test/run.sh` (extended by T03): the verbs, the swap, the armed block, the
  guards, with the wezterm stub.
- `spikes/pir-pane-drill/drill.sh` (extended by T04): the whole flow on a real headless mux.
  `send-text` bypasses the GUI's key table, so the drill appends the `picker` verb itself, as the
  binding would, and drives the picker through its real pty.
- What none of them reach: the GUI's key dispatch. That is T00's and T06's hands-on part.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS (Darwin 25.6.0) |
| Language / runtime | Node.js v26.7.0 (ESM `.mjs`), bash/zsh, WezTerm's embedded Lua |
| Toolchain | wezterm 20240203-110809-5046fc22; Claude Code 2.1.292 (the markers were measured on 2.1.291; T00 re-measures); pir installed at `~/.claude/pir-engine` (wrapper `~/.local/bin/pir`) |
| Deliberately absent | No standalone `lua`/`luajit`; Lua is tested through `wezterm show-keys`. No `package.json`, no npm dependencies. The pir source checkout is not at `~/src/plan-implement-review` on this machine; read pir from `~/.claude/pir-engine`. |

**The test command.** The `test` lines at the top, each from the repo root. The two fleet-picker
lines are guarded because T01 and T02 create those suites. cockpit-test takes about 107s and prints only
section headings and `ALL PASS (N checks)`; `VERBOSE=1` prints every check. New suites print one
summary line on success, every failure in full, no colour, and exit non-zero on failure.
`FORCE_COLOR` is not set in this session's environment (measured 2026-10-07); it was `3` on
2026-09-26 and the suites printed no escapes either way.

**Setup.** None: a fresh worktree ran pir-pane-test and stayed clean (measured 2026-10-07).

**Dependencies.** None may be added.

**End to end.** The picker is driven by `spikes/pir-pane-drill/drill.sh`, extended, on a private
headless `wezterm-mux-server` at 120×40 and 80×24 (fleet slot 59×22 and 39×12), with its fake
`claude agents` and fake pir as the free backend. It is run by the worker on T04 and is not in the
test block, as it was not for pir-pane: it takes minutes and needs `wezterm-mux-server`.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| ← through the GUI's key table: the callback firing, forwarding without lag or loss in every pane | `wezterm cli send-text` bypasses key bindings; only a real keyboard in a real window reaches them (T00, T06) |
| The picker in the live cockpit | Needs a rebuild of the live window, which closes every agent terminal (T06) |

### 5.2 Seatbelts

| Flag / mechanism | Default | Effect |
|---|---|---|
| Private `wezterm-mux-server`, own config, socket and pid file | T00, T04 | Never touches the live cockpit |
| `HOME` / `COCKPIT_DIR` / `PIR_HOME` in a scratch dir | cockpit-test, drill, T00 | The daemon and pir under test never touch real state |
| The drill's `pkill` shim | T04 | `cockpit-layout.sh` kills every `cockpitd.mjs` by name; the shim keeps the live one alive |
| T00's GUI probe: its own config, its own socket, a fake list program | T00 | The person types into a throwaway window, never the cockpit |
| T00's probe types into real `claude agents` but never sends `\r` or `\n` | T00 | Nothing is dispatched |

### 5.3 Outside actions

Nothing here costs money, is seen by anyone else, or touches an account.

| Action | Command | Bin | Why this bin |
|---|---|---|---|
| The suites | `bash spikes/fleet-picker-keys-test/run.sh`, `bash spikes/fleet-picker-test/run.sh`, `bash spikes/pir-pane-test/run.sh`, `bash spikes/cockpit-test/run.sh` | worker | Stubbed wezterm, scratch state; the keys suite runs `wezterm show-keys` with a scratch `HOME`, which opens no window |
| Point `~/.claude/cockpit/config.lua` `repo` at the task worktree, and restore it (T06) | edit the one line, then restore it | worker | Reversible in one edit; only takes effect when the person reopens the window |
| Point `~/.wezterm.lua` at the task worktree's `wezterm/cockpit.lua` (T06) | `ln -sfn <worktree>/wezterm/cockpit.lua /Users/jankrolikowski/.wezterm.lua`, `<worktree>` under `/Users/jankrolikowski/git/my-agentic-ide/.claude/worktrees/` | ask | The person's own file, read by every WezTerm window; the running window may reload its keys at once, harmless because the live daemon never arms the picker |
| Restore `~/.wezterm.lua` and confirm (T06) | `ln -sfn /Users/jankrolikowski/git/my-agentic-ide/wezterm/cockpit.lua /Users/jankrolikowski/.wezterm.lua`; `readlink /Users/jankrolikowski/.wezterm.lua` | worker | Puts back the installer's link; exact command, no choice in it |
| T00 headless probe | `bash spikes/fleet-picker-spike/probe.sh` | worker | Private mux; reads real `claude agents` without Enter; pir with scratch `PIR_HOME` |
| The drill | `bash spikes/pir-pane-drill/drill.sh` | worker | Private mux, scratch state, `pkill` shim |
| T00 GUI key probe | `bash spikes/fleet-picker-spike/gui.sh` | person | Opens a window and needs a real keyboard |
| Rebuilding the live window and trying the key (T06) | reopen WezTerm | person | Closes every agent terminal; the person chooses when |

---

## 6. Recovery

If the binding misbehaves, delete the `LeftArrow` entry from `wezterm/cockpit.lua` (WezTerm
reloads its config on save, no rebuild needed) and ← is plain again everywhere. If the picker
wedges the slot, rebuild the window, which always starts on `claude agents` with no picker.
Reverting this plan's commits restores today's cockpit. If T06 is interrupted with
`~/.wezterm.lua` or `config.lua` still pointed at a worktree, restore both (§5.3) before reopening.

---

## 7. Decisions and rationale

- 2026-10-07, person: add a key. Reverses pir-pane §2.1/§7's "click only, no key" (2026-09-26);
  the click stays. Variant A of the mock chosen; B (pop-up box) and C (instant flip) turned down.
  → opens, as well as Enter (person's change to the mock).
- 2026-10-07, person: names only in the picker; ← inside the picker does nothing; no picker when
  pir is absent; no footer hint for ← (the footer cannot tell an empty box, and it is already
  trimmed at 120 columns).
- 2026-10-07, person: read pir's screen for its empty box (§2.2) rather than plan a pir change.
- 2026-10-07, person: the defaults of §2.6 and §2.7 (switch dim while open, BitBucket closes it
  first, keyboard-only, a crash or Ctrl+C acts as Esc, stays open when focus leaves).
- 2026-10-07, person (plan review): T06 loads the branch's key binding by repointing
  `~/.wezterm.lua`, yes-first, because the live window reads `cockpit.lua` through that link to
  `main` and `config.lua`'s `repo` only moves the layout script and daemon. Keys typed before the
  picker shows go to the program behind it (§2.9), rather than adding a second key interceptor.
  The §5.3 bins approved as written.
- The decision in WezTerm, not the daemon (§1 Stance). The daemon's cmd tail polls every 200ms,
  and forwarding ← from there would land it after keys typed in the meantime.
- A separate picker pane, not a script typed into the slot like the custom prompt: the slot's
  program is running and cannot be quit, so the picker has to stand in front of it. Reuses the
  pir-pane swap rather than a second mechanism.
- The picker reuses `fleet-claude`/`fleet-pir`, so a choice and a footer click go through one
  switch path; only `picker` and `picker-cancel` are new verbs.
- No new prototype: the pir-pane mock already settled the look.

---

## 8. Explicitly out of scope

- Status lines in the picker. Claude's could be had, pir's needs a pir change; names only for now.
- Clicking in the picker. Keyboard-only for a first cut.
- A footer hint for ←. Declined; the footer cannot tell when ← will work.
- Any change to pir.
- A key inside an agent or a run. ← there is the program's own.
