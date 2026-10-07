-- fleet-picker T00, the GUI half: a throwaway window that puts a Lua callback in front
-- of every plain ←, exactly as the cockpit will, and logs what it did with each press.
-- Run through gui.sh, never as anyone's ~/.wezterm.lua.
--
-- Left pane: stand-in.mjs, a fake fleet list whose box draws Claude's placeholder line
-- when empty. Right pane: the person's zsh. The callback reads a fixture terminals.json
-- (armed on the stand-in's pane), reads the focused pane's screen, decides, and either
-- forwards ← with SendKey or appends `picker` to a scratch file. One log line per call.
local wezterm = require 'wezterm'
local act = wezterm.action
local DIR = os.getenv('FPG_DIR') or '/tmp'
local MARKER = '❯ describe a task for a new session'

local function now() return tonumber(wezterm.time.now():format('%s%.6f')) end
local function append(file, s)
  local f = io.open(DIR .. '/' .. file, 'a'); if f then f:write(s); f:close() end
end

-- The decision the cockpit's fleet-picker.lua will make, minimally (DESIGN 3.3).
local function decide(pane_id, terms, text)
  local p = type(terms) == 'table' and type(terms.fleet) == 'table' and terms.fleet.picker
  if type(p) ~= 'table' or p.pane ~= pane_id or p.program ~= 'claude' then return 'pass' end
  for line in (text .. '\n'):gmatch('([^\n]*)\n') do
    if line:gsub('%s+$', '') == MARKER then return 'open' end
  end
  return 'pass'
end

local seq, depth = 0, 0
local function on_left(window, pane)
  seq = seq + 1
  local n, t0, c0 = seq, now(), os.clock()
  depth = depth + 1
  local reentered = depth > 1
  local ok, verdict = pcall(function()
    local f = io.open(DIR .. '/terminals.json', 'r')
    local terms = nil
    if f then terms = wezterm.json_parse(f:read('*a')); f:close() end
    local text = pane:get_lines_as_text()
    return decide(pane:pane_id(), terms, text)
  end)
  if not ok then verdict = 'pass' end   -- a broken check must never break ←
  local t1 = now()
  if verdict == 'open' then append('picker', 'picker\n')
  else window:perform_action(act.SendKey { key = 'LeftArrow' }, pane) end
  local t2 = now()
  depth = depth - 1
  append('presses.log', string.format('%d pane=%d verdict=%s decide_ms=%.3f total_ms=%.3f cpu_ms=%.3f%s%s\n',
    n, pane:pane_id(), verdict, (t1 - t0) * 1000, (t2 - t0) * 1000, (os.clock() - c0) * 1000,
    reentered and ' REENTERED' or '', ok and '' or (' ERROR ' .. tostring(verdict))))
end

wezterm.on('gui-startup', function()
  local _, left, _ = wezterm.mux.spawn_window {
    args = { os.getenv('FPG_NODE') or 'node', os.getenv('FPG_STANDIN'), DIR },
    width = 100, height = 24,
  }
  left:split { direction = 'Right', size = 0.5, args = { os.getenv('SHELL') or '/bin/zsh', '-l' } }
  local f = io.open(DIR .. '/terminals.json', 'w')
  f:write(string.format('{"fleet":{"program":"claude","switchable":true,"available":true,' ..
    '"pickerOpen":false,"picker":{"pane":%d,"program":"claude"}}}', left:pane_id()))
  f:close()
end)

-- FPG_SELFTEST=1 with `show-keys`: run decide on fixed cases and write the verdicts.
if os.getenv('FPG_SELFTEST') then
  local armed = { fleet = { picker = { pane = 3, program = 'claude' } } }
  local cases = {
    { 'empty box', decide(3, armed, 'x\n' .. MARKER .. '   \ny') == 'open' },
    { 'text in box', decide(3, armed, '❯ hello') == 'pass' },
    { 'other pane', decide(4, armed, MARKER) == 'pass' },
    { 'not armed', decide(3, { fleet = { picker = nil } }, MARKER) == 'pass' },
    { 'no file', decide(3, nil, MARKER) == 'pass' },
    { 'marker inside a longer line', decide(3, armed, MARKER .. 'x') == 'pass' },
  }
  for _, c in ipairs(cases) do append('selftest', (c[2] and 'ok ' or 'FAIL ') .. c[1] .. '\n') end
end

return {
  keys = { { key = 'LeftArrow', mods = 'NONE', action = wezterm.action_callback(on_left) } },
  initial_cols = 100, initial_rows = 24,
  enable_tab_bar = false,
  window_close_confirmation = 'NeverPrompt',
  skip_close_confirmation_for_processes_named = { 'zsh', 'node', 'bash' },
  unix_domains = {},
}
