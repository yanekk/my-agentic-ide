-- WezTerm config for the cockpit.
--
-- Kept separate from your own ~/.wezterm.lua so the cockpit can be launched with
--   wezterm --config-file <this file> start
-- without disturbing your normal terminal setup. Merge it in later if you'd
-- rather the cockpit just be how WezTerm always opens.
--
-- WezTerm shows no on-screen keybinding hints (unlike Zellij), so the bindings
-- below are deliberately few and written down here rather than memorised.

local wezterm = require("wezterm")
local act = wezterm.action

local HOME = os.getenv("HOME")
local START_DIR = HOME .. "/src"

-- Finding the layout script.
--
-- `wezterm.config_file` reports the path wezterm was pointed at, which for a
-- symlinked ~/.wezterm.lua is the SYMLINK, not its target -- so resolving
-- relative to it yields nonsense like /Users/you/../bin/cockpit-layout.sh. Try
-- candidates and pick the first that exists instead.
local function first_existing(patterns)
  for _, pattern in ipairs(patterns) do
    local ok, hits = pcall(wezterm.glob, pattern)
    if ok and hits and #hits > 0 then return hits[1] end
  end
  return nil
end

local CONFIG_DIR = wezterm.config_file:match("(.*)/[^/]*$") or HOME
local COCKPIT = first_existing({
  CONFIG_DIR .. "/../bin/cockpit-layout.sh",              -- config read from the repo
  HOME .. "/src/agentic-ide/bin/cockpit-layout.sh",       -- merged to main
  HOME .. "/src/agentic-ide/.claude/worktrees/*/bin/cockpit-layout.sh", -- still on a branch
})

local LOGIN_SHELL = os.getenv("SHELL") or "/bin/zsh"

-- Run the layout through a LOGIN shell rather than executing it directly.
-- Launched from Finder or Spotlight, WezTerm inherits launchd's minimal PATH, so
-- a directly-spawned script sees no Homebrew and reports every tool as missing.
-- A login shell sources the usual profile files and gets the real PATH.
--
-- A window that cannot find the script must still open: falling back to a plain
-- shell beats spawning a path that does not exist, which kills the pane -- and
-- with it the whole window -- before anything can be read.
local LAUNCH = { LOGIN_SHELL, "-l" }
if COCKPIT then
  LAUNCH = { LOGIN_SHELL, "-l", "-c",
             string.format("exec '%s' '%s'", COCKPIT, START_DIR) }
else
  wezterm.log_error("cockpit: layout script not found; opening a plain shell")
end

-- Splits must name their program explicitly. `default_prog` below launches the
-- cockpit, and a split that inherited it would re-run the layout script and
-- recurse without end.
local LOGIN_SHELL = { os.getenv("SHELL") or "/bin/zsh", "-l" }

return {
  -- VSCode's default monospace stack on macOS is Menlo, then Monaco. WezTerm
  -- otherwise uses its own bundled JetBrains Mono, which is why it looked
  -- unfamiliar. Both of these are already on the system -- nothing to install.
  font = wezterm.font_with_fallback({ "Menlo", "Monaco", "Apple Color Emoji" }),
  font_size = 13.0,

  -- Open straight into the cockpit, in ~/src.
  default_cwd = START_DIR,
  default_prog = LAUNCH,

  -- Keep a failed pane on screen instead of closing the window over it.
  exit_behavior = "Hold",

  -- Big enough that revdiff's top pane is readable. The cockpit splits 55/45,
  -- so at 46 rows the diff gets ~25 and each bottom pane ~20.
  initial_rows = 46,
  initial_cols = 200,

  -- The diff pane leans on truecolor for syntax highlighting.
  color_scheme = "Tokyo Night",
  hide_tab_bar_if_only_one_tab = true,
  window_close_confirmation = "NeverPrompt",
  window_padding = { left = 4, right = 4, top = 2, bottom = 2 },
  scrollback_lines = 10000,

  keys = {
    -- Move between panes. ALT+arrow, no prefix key to remember.
    { key = "UpArrow",    mods = "ALT", action = act.ActivatePaneDirection("Up") },
    { key = "DownArrow",  mods = "ALT", action = act.ActivatePaneDirection("Down") },
    { key = "LeftArrow",  mods = "ALT", action = act.ActivatePaneDirection("Left") },
    { key = "RightArrow", mods = "ALT", action = act.ActivatePaneDirection("Right") },

    -- Zoom the focused pane full-window and back. Useful for reading a big diff
    -- without disturbing the layout the daemon depends on.
    { key = "z", mods = "ALT", action = act.TogglePaneZoomState },

    -- Another shell beside the existing one, in the same directory.
    { key = "t", mods = "ALT", action = act.SplitPane {
        direction = "Right",
        size = { Percent = 50 },
        command = { args = LOGIN_SHELL },
    } },

    -- Resize the diff/bottom split.
    { key = "=", mods = "ALT", action = act.AdjustPaneSize { "Up", 3 } },
    { key = "-", mods = "ALT", action = act.AdjustPaneSize { "Down", 3 } },
  },
}
