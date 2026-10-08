-- The ← decision for the fleet-slot program picker (plans/fleet-picker DESIGN §2.1–§2.2, §3.3).
--
-- Pure: everything arrives as an argument and nothing here touches the wezterm API, a file or
-- a clock, so spikes/fleet-picker-keys-test can run it exhaustively inside `wezterm show-keys`
-- (the only Lua on this machine). cockpit.lua does the reading and acts on the verdict.
--
-- Every doubt answers "pass": a wrong "open" takes a cursor move away from the person, a wrong
-- "pass" only costs a no-op ← on an empty box. So the markers are matched exactly and never
-- loosened (DESIGN §2.2).
local M = {}

-- claude agents' empty-box placeholder, a whole line once trailing blanks are trimmed. It is
-- shown exactly when the box is empty (measured on 2.1.291) and contains cockpitd's
-- LIST_MARKER, which the suite asserts.
M.CLAUDE_EMPTY = "❯ describe a task for a new session"

-- pir's key hint on its runs list with a bare box. A prefix, because pir cuts the line at the
-- pane width (39 columns at the smallest slot, T00); with text in the box it reads
-- `↵ start planning · …` instead, and the pairing screen does not draw it.
M.PIR_EMPTY = "↑↓ move · ↵ open"

local function lines(text)
  return (text .. "\n"):gmatch("([^\n]*)\n")
end

local function has_claude_empty(text)
  for line in lines(text) do
    -- `[ \t\r]` rather than `%s`, so nothing outside plain trailing blanks is trimmed away.
    if line:gsub("[ \t\r]+$", "") == M.CLAUDE_EMPTY then return true end
  end
  return false
end

local function has_pir_empty(text)
  local n = #M.PIR_EMPTY
  for line in lines(text) do
    if line:sub(1, n) == M.PIR_EMPTY then return true end
  end
  return false
end

-- terms: the parsed terminals.json, or nil. text: the focused pane's visible screen.
function M.decide(pane_id, terms, text)
  if type(terms) ~= "table" or type(terms.fleet) ~= "table" then return "pass" end
  local p = terms.fleet.picker
  if type(p) ~= "table" or p.pane ~= pane_id or type(text) ~= "string" then return "pass" end
  if p.program == "claude" then return has_claude_empty(text) and "open" or "pass" end
  if p.program == "pir" then return has_pir_empty(text) and "open" or "pass" end
  return "pass"
end

return M
