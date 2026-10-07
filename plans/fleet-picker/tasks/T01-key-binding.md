# T01 — key-binding

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

## Goal

The ← decision of DESIGN §2.1–§2.2 as a pure Lua function, its test suite run in WezTerm's own
Lua, and the binding in `wezterm/cockpit.lua` that uses it: forward ← unchanged unless the
decision says open, in which case append `picker` to the cmd channel. This is the only place the
keypress is judged, and it must fail toward plain ← on every error.

## Design sections this implements

DESIGN §1 Stance, §2.1, §2.2, §2.9 (the callback rows), §3.1, §3.3, §3.5 (reading `fleet.picker`).

## Files

- `wezterm/fleet-picker.lua` (new)
- `wezterm/cockpit.lua` (extended)
- `spikes/fleet-picker-keys-test/run.sh`, `spikes/fleet-picker-keys-test/decide.lua` (new)

## Interface

```lua
-- wezterm/fleet-picker.lua
local M = {}
M.CLAUDE_EMPTY = "❯ describe a task for a new session"   -- a whole line, trailing blanks trimmed
M.PIR_EMPTY    = "↑↓ move · ↵ open"                       -- a line prefix
function M.decide(pane_id, terms, text) --> "open" | "pass"
return M
```

In `cockpit.lua`: locate the module next to the layout script the file already finds
(`<repo>/wezterm/fleet-picker.lua`, derived from `COCKPIT`), `pcall(dofile, …)`; if that fails,
add no binding. Otherwise:

```lua
{ key = "LeftArrow", mods = "NONE", action = wezterm.action_callback(function(window, pane)
    -- pcall: read ~/.claude/cockpit/terminals.json, wezterm.json_parse,
    --        pane:get_lines_as_text(rows), M.decide(pane:pane_id(), terms, text)
    -- "open" → append "picker\n" to CMD_FILE; anything else, or any error →
    -- window:perform_action(act.SendKey { key = "LeftArrow" }, pane)
  end) },
```

`SendKey`, not `SendString`, so WezTerm encodes ← per the pane's cursor-key mode (the same reason
`Cmd+→` sends the End key, see the comment in `cockpit.lua`).

## Tests

- [ ] open: claude armed, matching pane, placeholder line present (with and without trailing blanks).
- [ ] open: pir armed, matching pane, a line starting with the pir hint.
- [ ] pass: `terms` nil; no `fleet`; `fleet.picker` nil or not a table; a different pane id.
- [ ] pass: claude armed, placeholder absent; placeholder as part of a longer line; placeholder
      text with the box holding text (`❯ xy`).
- [ ] pass: pir armed with `↵ start planning` hint; pir armed but the claude line on screen, and the reverse.
- [ ] pass: unknown `program`.
- [ ] `M.CLAUDE_EMPTY` contains `LIST_MARKER` from `bin/cockpitd.mjs` (grep both files).
- [ ] purity: `fleet-picker.lua` contains no `io.`, `os.`, `wezterm.`, `require`.
- [ ] `wezterm --config-file wezterm/cockpit.lua show-keys` with a scratch `HOME` exits 0 and lists a
      `LeftArrow` binding with no modifier in the default key table; with the module renamed away it
      lists none there and still exits 0. Read only the default table: `copy_mode` already has an
      unmodified `LeftArrow -> CopyMode(MoveLeft)`, so a whole-output grep passes either way.

## Done when

- [ ] `spikes/fleet-picker-keys-test/run.sh` passes and prints one summary line.
- [ ] `cockpit.lua` binds ← through `decide`, with every error path forwarding ←.
- [ ] Every test line in DESIGN passes.

## Needs a person

None here: the GUI path is T00's and T06's.
