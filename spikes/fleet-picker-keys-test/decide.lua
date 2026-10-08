-- The fleet-picker ← decision, tested inside WezTerm's own Lua (there is no other Lua on this
-- machine). run.sh evaluates this file as a config with `wezterm --config-file decide.lua
-- show-keys`; it loads wezterm/fleet-picker.lua from FPK_MODULE, runs every case, and writes
-- one `ok <name>` or `FAIL <name>: <detail>` line per case to FPK_OUT. The harness may touch
-- files; the module under test may not (run.sh greps it).
local OUT = assert(os.getenv("FPK_OUT"), "FPK_OUT unset")
local results = {}
local function record(ok, name, detail)
  table.insert(results, (ok and "ok " or "FAIL ") .. name .. (ok and "" or (": " .. detail)))
end

local loaded, M = pcall(dofile, assert(os.getenv("FPK_MODULE"), "FPK_MODULE unset"))
if not loaded or type(M) ~= "table" or type(M.decide) ~= "function" then
  record(false, "the module loads and exports decide", tostring(M))
else
  local CL, PI = M.CLAUDE_EMPTY, M.PIR_EMPTY
  local function armed(program, pane)
    return { fleet = { program = program, switchable = true, available = true,
                       pickerOpen = false, picker = { pane = pane or 7, program = program } } }
  end
  -- `{ "header", ... }` would keep every vararg, but one placed mid-table keeps only the first.
  local function screen(...)
    local t = { "header", ... }
    table.insert(t, "footer")
    return table.concat(t, "\n")
  end
  local function case(name, want, pane_id, terms, text)
    local ok, got = pcall(M.decide, pane_id, terms, text)
    if not ok then record(false, name, "decide raised " .. tostring(got))
    else record(got == want, name, "want " .. want .. ", got " .. tostring(got)) end
  end

  -- open
  case("claude armed, placeholder line", "open", 7, armed("claude"), screen("", CL, ""))
  case("claude armed, placeholder with trailing blanks", "open", 7, armed("claude"), screen(CL .. "     "))
  case("claude armed, placeholder as the last line with no newline", "open", 7, armed("claude"), "x\n" .. CL)
  case("claude armed, placeholder with a trailing tab and CR", "open", 7, armed("claude"), screen(CL .. " \t\r"))
  case("pir armed, the full hint line", "open", 7, armed("pir"),
       screen(PI .. " · Ctrl+O browser · Ctrl+P pair · esc quit"))
  case("pir armed, the hint cut at 39 columns", "open", 7, armed("pir"),
       screen("↑↓ move · ↵ open · Ctrl+O browser · Ctr"))
  case("pir armed, the bare prefix", "open", 7, armed("pir"), screen(PI))
  case("pane id as a JSON float still matches", "open", 7, armed("claude", 7.0), screen(CL))

  -- pass: not armed
  case("terms nil", "pass", 7, nil, screen(CL))
  case("terms not a table", "pass", 7, "x", screen(CL))
  case("no fleet block", "pass", 7, { terminals = {} }, screen(CL))
  case("fleet not a table", "pass", 7, { fleet = true }, screen(CL))
  case("fleet.picker nil", "pass", 7, { fleet = { program = "claude" } }, screen(CL))
  case("fleet.picker not a table", "pass", 7, { fleet = { picker = 7 } }, screen(CL))
  case("fleet.picker a string", "pass", 7, { fleet = { picker = "claude" } }, screen(CL))
  case("a different pane id", "pass", 8, armed("claude"), screen(CL))
  case("picker.pane missing", "pass", 7, { fleet = { picker = { program = "claude" } } }, screen(CL))
  case("picker.pane a string", "pass", 7, armed("claude", "7"), screen(CL))
  case("text nil", "pass", 7, armed("claude"), nil)

  -- pass: claude armed, box not empty
  case("claude armed, placeholder absent", "pass", 7, armed("claude"), screen("❯ ", "esc back"))
  case("claude armed, empty screen", "pass", 7, armed("claude"), "")
  case("claude armed, placeholder inside a longer line", "pass", 7, armed("claude"), screen(CL .. " x"))
  case("claude armed, placeholder after a box border", "pass", 7, armed("claude"), screen("│ " .. CL))
  case("claude armed, placeholder with a leading blank", "pass", 7, armed("claude"), screen(" " .. CL))
  case("claude armed, the box holding text", "pass", 7, armed("claude"), screen("❯ xy"))
  case("claude armed, the placeholder words typed after text", "pass", 7, armed("claude"),
       screen("❯ xy describe a task for a new session"))

  -- pass: pir armed, box not empty, and the two markers crossed
  case("pir armed, the start-planning hint", "pass", 7, armed("pir"),
       screen("↵ start planning · shift+↵ new line · esc clear"))
  case("pir armed, the hint indented", "pass", 7, armed("pir"), screen("  " .. PI))
  case("pir armed, the hint mid-line", "pass", 7, armed("pir"), screen("x " .. PI))
  case("pir armed but the claude line on screen", "pass", 7, armed("pir"), screen(CL))
  case("claude armed but the pir hint on screen", "pass", 7, armed("claude"), screen(PI .. " · esc quit"))

  -- pass: unknown program
  case("unknown program", "pass", 7, armed("shell"), screen(CL, PI))
  case("program missing", "pass", 7, { fleet = { picker = { pane = 7 } } }, screen(CL, PI))
end

local f = assert(io.open(OUT, "w"))
f:write(table.concat(results, "\n"), "\n")
f:close()
return {}
