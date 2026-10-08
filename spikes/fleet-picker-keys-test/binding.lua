-- The ← callback in wezterm/cockpit.lua, driven with a fake window and pane inside WezTerm's own
-- Lua. run.sh evaluates this as a config with `wezterm show-keys` and a scratch HOME. It patches
-- wezterm.action_callback to hand back the function itself, loads cockpit.lua from FPK_COCKPIT,
-- finds the unmodified LeftArrow entry, and calls it against real files under
-- $HOME/.claude/cockpit: what reaches `cmd`, and whether ← was forwarded. One `ok`/`FAIL` line
-- per case to FPK_OUT. The GUI's key dispatch itself is not reached here (DESIGN §5.1).
local wezterm = require("wezterm")
local OUT = assert(os.getenv("FPK_OUT"), "FPK_OUT unset")
local DIR = os.getenv("HOME") .. "/.claude/cockpit"
local CMD, TERMS = DIR .. "/cmd", DIR .. "/terminals.json"
local CL = "❯ describe a task for a new session"
local PI = "↑↓ move · ↵ open · Ctrl+O browser · Ctr"

local results = {}
local function record(ok, name, detail)
  table.insert(results, (ok and "ok " or "FAIL ") .. name .. (ok and "" or (": " .. detail)))
end
local function write(path, s) local f = assert(io.open(path, "w")); f:write(s); f:close() end
local function read(path)
  local f = io.open(path, "r"); if not f then return nil end
  local s = f:read("*a"); f:close(); return s
end

wezterm.action_callback = function(fn) return { __callback = fn } end
local loaded, config = pcall(dofile, assert(os.getenv("FPK_COCKPIT"), "FPK_COCKPIT unset"))
local callback = nil
if loaded and type(config) == "table" then
  for _, k in ipairs(config.keys or {}) do
    if k.key == "LeftArrow" and k.mods == "NONE" and type(k.action) == "table" then
      callback = k.action.__callback
    end
  end
end

if not callback then
  record(false, "cockpit.lua loads and binds an unmodified LeftArrow callback", tostring(config))
else
  local function armed(program, pane)
    return string.format('{"fleet":{"program":"%s","switchable":true,"available":true,' ..
      '"pickerOpen":false,"picker":{"pane":%d,"program":"%s"}}}', program, pane or 7, program)
  end
  local function press(name, opts)
    os.remove(CMD)
    if opts.cmd_is_dir then os.execute("mkdir -p '" .. CMD .. "'") end
    if opts.terms then write(TERMS, opts.terms) else os.remove(TERMS) end
    local forwarded = {}
    local window = { perform_action = function(_, action, p) table.insert(forwarded, { action, p }) end }
    local pane = {
      pane_id = function() return opts.pane or 7 end,
      get_lines_as_text = function()
        if opts.screen_raises then error("screen read failed on purpose") end
        return opts.screen
      end,
    }
    local ok, err = pcall(callback, window, pane)
    local cmd = (not opts.cmd_is_dir) and read(CMD) or nil
    if opts.cmd_is_dir then os.execute("rmdir '" .. CMD .. "'") end
    if not ok then return record(false, name, "the callback raised " .. tostring(err)) end
    -- %q would write a newline as backslash-newline and split the result line.
    local shown = cmd and ('"' .. cmd:gsub("\n", "\\n") .. '"') or "absent"
    if opts.want == "open" then
      record(cmd == "picker\n" and #forwarded == 0, name,
             string.format("cmd=%s, forwarded %d", shown, #forwarded))
    else
      record(cmd == nil and #forwarded == 1 and forwarded[1][2] == pane, name,
             string.format("cmd=%s, forwarded %d", shown, #forwarded))
    end
  end

  press("claude armed, empty box: appends picker, forwards nothing",
        { terms = armed("claude"), screen = "x\n" .. CL .. "  \ny", want = "open" })
  press("pir armed, bare hint: appends picker",
        { terms = armed("pir"), screen = "runs\n" .. PI, want = "open" })
  press("claude armed, text in the box: forwards ←",
        { terms = armed("claude"), screen = "❯ xy", want = "pass" })
  press("another pane: forwards ←",
        { terms = armed("claude"), pane = 8, screen = CL, want = "pass" })
  press("not armed: forwards ←",
        { terms = '{"fleet":{"program":"claude","picker":null}}', screen = CL, want = "pass" })
  press("terminals.json missing: forwards ←", { screen = CL, want = "pass" })
  press("terminals.json corrupt: forwards ←", { terms = '{"fleet":', screen = CL, want = "pass" })
  press("terminals.json empty: forwards ←", { terms = "", screen = CL, want = "pass" })
  press("terminals.json a JSON array: forwards ←", { terms = "[1,2]", screen = CL, want = "pass" })
  press("reading the screen raises: forwards ←",
        { terms = armed("claude"), screen_raises = true, want = "pass" })
  press("cmd cannot be written: forwards ←",
        { terms = armed("claude"), screen = CL, cmd_is_dir = true, want = "pass" })
end

local f = assert(io.open(OUT, "w"))
f:write(table.concat(results, "\n"), "\n")
f:close()
return {}
