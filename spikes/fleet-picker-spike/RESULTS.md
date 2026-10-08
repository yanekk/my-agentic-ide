# fleet-picker T00 — keypress spike: results

Measured 2026-10-07 on wezterm 20240203-110809-5046fc22, Claude Code 2.1.292, the installed
pir at `~/.claude/pir-engine`, Node v26.7.0. Raw headless numbers: `results.json`; raw GUI logs:
`last-gui-run/`.

```
bash spikes/fleet-picker-spike/probe.sh            # headless, ~2 min, private muxes
PROBE_FAIL=1 bash spikes/fleet-picker-spike/probe.sh   # fails after bring-up: teardown check
bash spikes/fleet-picker-spike/gui.sh              # the person, at a keyboard
```

## Verdicts

| Gate | Verdict | Evidence |
|---|---|---|
| The callback can read pane text in the GUI | **pass** | 14 of 14 presses on the stand-in's empty box decided `open` from `pane:get_lines_as_text()`; 12 with text decided `pass` |
| `SendKey` reaches zsh and the stand-in with the right encoding, no re-entry | **pass** | stand-in received 12 arrow reads for 12 `pass` calls, all `1b 5b 44` (CSI ←, its cursor-key mode); 0 re-entries, 0 errors in 45 calls; zsh cursor moved every time (person) |
| No lag the person notices, holding ← included | **pass** | callback total median 0.84ms, max 1.87ms (n=45); person: "it was ok", typed line came out exactly as typed |
| Markers intact at 39×12 | **pass** | both programs, both sizes (below) |

## 1. Claude's echo time (59×22, 20 samples)

From just before `send-text` of one `x` until `get-text` no longer shows the placeholder line.

| | median | min | max |
|---|---|---|---|
| char hides placeholder | 41.2ms | 21.7 | 64.0 |
| backspace restores it | 24.8ms | 19.6 | 43.0 |
| one `send-text` call (included above) | 25.1ms | 11.3 | 42.7 |
| one `get-text` call (poll resolution) | 10.4ms | 9.6 | 13.9 |

0 misses. Net of the `send-text` call itself, Claude redraws its box roughly 15–40ms after a
key arrives. That is the window of DESIGN §2.9 in which a character typed just before ← is not
yet on screen and the picker would open over it.

## 2. The markers

| | 59×22 | 39×12 |
|---|---|---|
| claude `❯ describe a task for a new session` | exact line after trimEnd; hides with text; back when cleared | same, intact |
| pir, empty runs list | `↑↓ move · ↵ open · Ctrl+O browser · Ctrl+P pair · esc quit` at column 0 | `↑↓ move · ↵ open · Ctrl+O browser · Ctr` (cut at the width; the prefix is intact) |
| pir, rig run listed (`rig  work  ● running`) | same line | same, cut |

With text in pir's box the hint reads `↵ start planning · shift+↵ new line · esc clear` and the
marker is gone; cleared, it returns. pir's hint is truncated at 39 columns, so T01 must match a
line *starting with* `↑↓ move · ↵ open`, never the full line.

Two set-up facts the probe hit: `claude agents` started in an untrusted folder opens on the
folder-trust prompt (no placeholder), so it runs from the main checkout; and pir on a scratch
`PIR_HOME` shows `waiting for pir's backend…` until a backend runs on that home, so the probe
starts `api-service.mjs` there as the rig's `scratchBackend()` does. The marker is drawn even
while waiting.

## 3. Picker open time (10 samples each)

From appending `picker` to a scratch cmd file, through `stub-daemon.mjs` (split a node pane
`--left 50%` into the slot, `move-pane-to-new-tab` the slot pane, `activate-pane`), to the
stub picker's first frame. ms, median (min–max):

| step done | 200ms poll (today's `tail()`) | `fs.watch` on the directory |
|---|---|---|
| verb read | 141.5 (10–202) | 12.2 (3–18) |
| split | 163.8 | 42.7 |
| park | 179.2 | 63.0 |
| activate | 188.8 | 74.5 |
| picker's first frame | **212.2 (98–278)** | **99.9 (74–119)** |
| frame visible to `get-text` | 219.6 (103–290) | 108.7 (84–133) |

The poll dominates: it is over half the open time and all of its spread. T03 should read `cmd`
through a directory watch (keeping the poll as a fallback), which roughly halves the §2.9 gap in
which keys typed after ← reach the program behind the picker.

## 4. The GUI run (person, 2026-10-07)

`gui.lua`: a `LeftArrow`/no-modifier `action_callback` that reads a fixture `terminals.json`,
`pane:get_lines_as_text()`, a minimal `decide`, then `SendKey{key='LeftArrow'}` or appends
`picker`. Timing: `wezterm.time.now():format('%s%.6f')` gives microsecond wall time and works
there; `os.clock()` gives CPU time and works too.

| | calls | callback total ms median / max |
|---|---|---|
| stand-in pane, empty box → `open` | 14 (14 picker verbs written) | |
| stand-in pane, text → `pass` | 12 (12 arrow reads received) | |
| zsh pane → `pass` | 19 | |
| all | 45 | 0.84 / 1.87 |

Key repeat reaches the callback once per repeat (a held ← logs a call each). The first call in
a pane is the slowest (~1.9ms, a cold read); later ones are 0.2–0.5ms.

## Teardown

`probe.sh` kills the rig, both backends and both muxes on every exit and fails the run if
`pgrep -f <scratch>/` still finds anything: confirmed on success and with `PROBE_FAIL=1`.
`gui.sh` kills anything matching `gui.lua` after the window closes and reported it gone.
