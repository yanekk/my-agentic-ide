# T00 — keypress-spike

**Phase:** 0 · **Depends on:** — · **Weight:** medium

## Goal

Binding plain ← in `wezterm/cockpit.lua` puts a Lua callback in front of every left arrow in the
window, in every pane. Before anything is built on that, prove on this machine's WezTerm
(20240203) that a GUI key callback can read the focused pane's screen, forward ← with
`SendKey` so the pane gets its own encoding, and do it without visible lag, lost keys or
reordering; and measure the two timings DESIGN §2.9 and §3.4 depend on. Throwaway: the scripts
stay under `spikes/fleet-picker-spike/` as the record, and nothing in `bin/` or `wezterm/` is
changed.

## Design sections this implements

DESIGN §1 Stance, §2.2, §2.9, §3.4, §5.1.

## Files

- `spikes/fleet-picker-spike/probe.sh` (new): the headless measurements.
- `spikes/fleet-picker-spike/gui.lua`, `spikes/fleet-picker-spike/gui.sh` (new): the GUI probe
  window for the person.
- `spikes/fleet-picker-spike/RESULTS.md` (new): what was measured, with numbers.

## What to measure

Headless (`probe.sh`, a private `wezterm-mux-server`):

1. Claude's echo time: in real `claude agents` at 59×22, send one printable character and poll
   `get-text` until the placeholder line is gone; 20 samples, median and max. Clear with
   backspace between samples. Never send `\r` or `\n`.
2. The markers at both slot sizes, 59×22 and 39×12: does `❯ describe a task for a new session`
   appear intact in real `claude agents`, and does pir's `↑↓ move · ↵ open` appear intact on its
   runs list (scratch `PIR_HOME`, and once with a pretend run listed via pir's conversation rig
   at `~/.claude/pir-engine/src/shell/conversation-rig.mjs`)?
3. Picker open time: from appending a verb to a scratch cmd file, through a stub that does what
   T03 will (split a pane running a small node script into the slot, park the slot pane,
   activate), to the script's first frame on screen; 10 samples, with the current 200ms poll and
   with an `fs.watch` on the directory.

GUI (`gui.sh`, the person): a window with its own config file and socket, two panes (a stand-in
list printing the claude placeholder line, and zsh), and a ← binding whose callback reads a
fixture `terminals.json`, calls a minimal decide, and either `SendKey`s ← or appends `picker` to a
scratch file. The callback logs each press to a scratch file: pane, verdict, and wall time spent
in the callback (`wezterm.time.now()` or `os.clock()`, whichever works there).

## Tests

- [ ] `probe.sh` tears down its mux and confirms it is gone, on success and on failure.
- [ ] The GUI log shows one line per ← the person pressed, none missing, none doubled (no
      re-entry through `SendKey`).

## Done when

- [ ] RESULTS.md holds the echo median/max, marker results at both sizes for both programs, and
      the open-time numbers with and without a directory watch.
- [ ] The person's GUI run is recorded in FINDINGS.md with the date, and the callback's own time
      per press is in RESULTS.md.
- [ ] RESULTS.md states the verdict for each gate below, and for any that fails the task stops
      and goes to the person.

Gates: the callback can read pane text in the GUI; `SendKey` reaches zsh and the stand-in with
the right encoding and does not re-enter the binding; no lag the person notices, including when
holding ← for key repeat; the markers are intact at 39×12 (if not, T01 records which size loses
them, and the picker simply does not open there).

## Environment (the worker owns this)

```
bash spikes/fleet-picker-spike/probe.sh      # brings up and tears down its own private mux
```

The GUI window is closed by the person; `gui.sh` kills anything it started on exit and the worker
confirms with `pgrep -f spikes/fleet-picker-spike/gui.lua` that nothing is left.

## Outside actions

- T00 headless probe — `worker`
- T00 GUI key probe — `person`

## Needs a person

```
bash spikes/fleet-picker-spike/gui.sh
```

Expect: a new small WezTerm window (not the cockpit), two panes. In the right pane type
`echo hello world`, press ← a few times, hold ← for a second, then type more and press Enter. In
the left pane press ← a few times. Close the window.
Tell me: did ← move the cursor in the right pane every time, with no lag compared to your normal
terminal, and did the typed line come out exactly as typed?
