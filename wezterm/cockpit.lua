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

-- Where this checkout lives, and which projects root the fleet view opens in.
--
-- Both are recorded by bin/install.sh rather than worked out here, because this
-- file cannot reliably locate itself: `wezterm.config_file` reports the path
-- wezterm was pointed at, which for a symlinked ~/.wezterm.lua is the SYMLINK,
-- so resolving relative to it yields nonsense like /Users/you/../bin/. Guessing
-- instead meant a hardcoded $HOME/src/agentic-ide, which broke for any other
-- clone name or projects root (~/git on a work machine). The installer knows
-- both for certain, so it writes them down.
--
-- Absent -- an un-installed checkout -- everything below falls back to the old
-- guesses, so a plain `wezterm --config-file .../cockpit.lua start` still works.
local function installed()
  local ok, cfg = pcall(dofile, HOME .. "/.claude/cockpit/config.lua")
  if ok and type(cfg) == "table" then return cfg end
  return {}
end
local CFG = installed()

local function first_existing(patterns)
  for _, pattern in ipairs(patterns) do
    local ok, hits = pcall(wezterm.glob, pattern)
    if ok and hits and #hits > 0 then return hits[1] end
  end
  return nil
end

-- A default_cwd that does not exist leaves every pane starting somewhere
-- arbitrary, so fall back to $HOME rather than trust a stale config.
local START_DIR = first_existing({ CFG.start_dir or (HOME .. "/src") }) or HOME

-- Finding the layout script: try candidates, take the first that exists.
local CONFIG_DIR = wezterm.config_file:match("(.*)/[^/]*$") or HOME
local CANDIDATES = {}
if CFG.repo then
  table.insert(CANDIDATES, CFG.repo .. "/bin/cockpit-layout.sh")           -- installed
  table.insert(CANDIDATES, CFG.repo .. "/.claude/worktrees/*/bin/cockpit-layout.sh")
end
table.insert(CANDIDATES, CONFIG_DIR .. "/../bin/cockpit-layout.sh")        -- config read from the repo
table.insert(CANDIDATES, HOME .. "/src/agentic-ide/bin/cockpit-layout.sh") -- never installed
table.insert(CANDIDATES, HOME .. "/src/agentic-ide/.claude/worktrees/*/bin/cockpit-layout.sh")
local COCKPIT = first_existing(CANDIDATES)

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

-- Terminal-list gestures reach cockpitd through a command channel: a key appends
-- one verb (new/next/prev/close) to ~/.claude/cockpit/cmd, and the daemon tails
-- it and moves the panes. The daemon is the only thing that touches the layout,
-- so a manual `SplitPane` here -- which it neither tracks nor parks -- is exactly
-- what the ALT+t binding used to do wrong. The verbs are fixed literals, so this
-- shells out to a plain append with nothing to quote.
local CMD_FILE = HOME .. "/.claude/cockpit/cmd"
local function cockpit_cmd(verb)
  return wezterm.action_callback(function()
    local f = io.open(CMD_FILE, "a")
    if f then f:write(verb .. "\n"); f:close() end
  end)
end

return {
  -- VSCode's default monospace stack on macOS is Menlo, then Monaco. WezTerm
  -- otherwise uses its own bundled JetBrains Mono, which is why it looked
  -- unfamiliar. Both of these are already on the system -- nothing to install.
  font = wezterm.font_with_fallback({ "Menlo", "Monaco", "Apple Color Emoji" }),
  font_size = 13.0,

  -- Open straight into the cockpit, in the projects root the installer recorded.
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
  -- Parked agent terminals live in tabs of this window (see cockpitd.mjs). The
  -- tab bar is off so they stay off screen and cannot be clicked into --
  -- activating one would fill the window with a bare shell and look exactly like
  -- the cockpit had vanished. `wezterm cli list` still shows them, titled.
  enable_tab_bar = false,
  -- Closing this window kills every parked agent terminal with it (see the
  -- known limits in CLAUDE.md), so the red button must ask first.
  window_close_confirmation = "AlwaysPrompt",
  -- ...and the prompt must actually appear. WezTerm skips it when every pane is
  -- running a "harmless" process, and that default list is exactly the shells
  -- the cockpit runs (zsh, bash, sh, fish, ...), so an empty list is what makes
  -- AlwaysPrompt mean always.
  skip_close_confirmation_for_processes_named = {},
  window_padding = { left = 4, right = 4, top = 2, bottom = 2 },
  scrollback_lines = 10000,

  -- The left button belongs to claude, whole. Do not bind any part of it.
  --
  -- claude does its own text selection: it turns on full mouse reporting
  -- (measured: `?1000h ?1002h ?1003h ?1006h`), draws its own highlight, and on
  -- release copies the selected text to the system clipboard with OSC 52 --
  -- announcing it as "copied N chars to clipboard". Driven with synthetic
  -- press/motion/release on a pty it does exactly that, and WezTerm honours the
  -- OSC 52 write (probed: a BEL-terminated `ESC ] 52 ; c ; <base64>` lands in
  -- the macOS pasteboard). So drag-to-copy over the Claude pane is claude's job
  -- and it works -- as long as nothing intercepts a piece of the gesture.
  --
  -- Two attempts at "helping" both made it worse, and neither is to be retried:
  --
  --   * Binding Down+Drag+Up under `mouse_reporting = true` gave WezTerm the
  --     selection and left claude blind: nothing in the pane was clickable.
  --   * Binding only Drag+Up -- meant to leave claude the press -- broke it
  --     twice over. claude dispatches a *click* on the RELEASE (`onClickAt`),
  --     not the press, so swallowing the release swallowed every click; and
  --     because the release never reached `pane.mouse_event`, wezterm-term's
  --     `current_mouse_buttons` still held Left, so `mouse_report_button_number`
  --     kept encoding every later mouse *move* as a held-left-button drag. claude
  --     therefore never saw the hover that ends a drag (`py()`: motion with no
  --     button) and its selection followed the pointer forever, with the next
  --     click starting another one.
  --
  -- The lesson is that the gesture is indivisible: press, motion, release and
  -- the button-up bookkeeping are one transaction, and WezTerm can only take all
  -- of it or none of it. It takes none.
  --
  -- Shift remains the escape hatch for a plain *terminal* selection, via
  -- WezTerm's own bypass_mouse_reporting_modifiers (left at its SHIFT default):
  -- held, the event is not reported to claude at all and the stock bindings
  -- handle it -- Shift+drag selects, Shift+double/triple-click takes a word or a
  -- line. That is the way to copy something claude's own selection cannot reach.
  --
  -- A drag whose press was eaten is the one way claude's copy silently fails:
  -- with no `onSelectionStart` there is no anchor, so the release finds nothing
  -- to copy even though a highlight appeared. macOS WezTerm eats exactly that
  -- press by default, on the click that focuses the window -- so it is turned
  -- off here.
  swallow_mouse_click_on_window_focus = false,
  swallow_mouse_click_on_pane_focus = false,

  keys = {
    -- Move between panes. CMD+ALT+arrow, directional. This used to be plain
    -- ALT+arrow, but on macOS ALT+arrow is the word-motion gesture (below), so
    -- pane switching moved up a modifier to leave Option free for the line editor.
    { key = "UpArrow",    mods = "CMD|ALT", action = act.ActivatePaneDirection("Up") },
    { key = "DownArrow",  mods = "CMD|ALT", action = act.ActivatePaneDirection("Down") },
    { key = "LeftArrow",  mods = "CMD|ALT", action = act.ActivatePaneDirection("Left") },
    { key = "RightArrow", mods = "CMD|ALT", action = act.ActivatePaneDirection("Right") },

    -- Zoom the focused pane full-window and back. Useful for reading a big diff
    -- without disturbing the layout the daemon depends on.
    { key = "z", mods = "ALT", action = act.TogglePaneZoomState },

    -- Manage the attached agent's terminals (VSCode's terminal-tab gestures).
    -- These go through the daemon so every terminal is tracked and parked; a
    -- raw SplitPane would leave an untracked pane the daemon swaps around.
    { key = "t", mods = "ALT", action = cockpit_cmd("new") },
    { key = "]", mods = "ALT", action = cockpit_cmd("next") },
    { key = "[", mods = "ALT", action = cockpit_cmd("prev") },
    { key = "w", mods = "ALT", action = cockpit_cmd("close") },

    -- NB: there is deliberately no Shift+O binding here. revdiff's own flush
    -- gesture IS Shift+O (`map O flush_output`), so binding it in WezTerm stole
    -- the key: the diff pane never flushed (no review reached the agent), and no
    -- other pane could type an `O` at all. The focus-jump-to-Claude that used to
    -- hang off this binding is now driven by revdiff itself, via its
    -- --post-flush-command (see diffCommand in cockpitd.mjs): a *successful* flush
    -- appends `focus-claude` to the cmd channel, so O both sends the review and
    -- lands you in the agent's pane in one press, and O stays a normal key
    -- everywhere else.

    -- Resize the diff/bottom split.
    { key = "=", mods = "ALT", action = act.AdjustPaneSize { "Up", 3 } },
    { key = "-", mods = "ALT", action = act.AdjustPaneSize { "Down", 3 } },

    -- Line-editor motions that mirror macOS text fields, translated to the
    -- readline/zsh control keys every shell's line editor understands. SendKey
    -- (not SendString) so WezTerm emits them into whichever pane has focus, and
    -- these are window-global so they reach every terminal and the agent input.
    --
    --   Option+arrow  word-by-word     ESC-b / ESC-f  (backward/forward-word)
    --   Option+Delete  delete a word   C-w            (unix-word-rubout, space-delimited)
    --   Cmd+LeftArrow   line start     C-a            (beginning-of-line)
    --   Cmd+RightArrow  line end       End key        (see below -- NOT C-e)
    --   Cmd+Delete  erase to line start  C-u          (backward-kill-line)
    --
    -- Word *motion* stops at punctuation (readline's word chars), not purely at
    -- spaces; deletion (C-w) is space-delimited. Rebind in ~/.zshrc for stricter
    -- space-only motion -- the shell owns that, WezTerm only forwards the keys.
    --
    -- Cmd+RightArrow sends the End *key*, not C-e, because revdiff binds C-e to
    -- "open annotation in $EDITOR": pressed in its annotation editor, C-e spawns
    -- $EDITOR over the diff pane and leaves it wedged. End-of-line is the one
    -- motion where the two apps disagree on the escape sequence -- revdiff's
    -- editor only honours the CSI form (ESC [ F) and reads SS3 (ESC O F) as
    -- literal text, while this zsh runs in application-cursor mode and binds only
    -- SS3. SendKey{End} threads that needle: WezTerm encodes End per the focused
    -- pane's DECCKM, so revdiff (normal mode) gets ESC [ F and the shell
    -- (application mode) gets ESC O F -- each its own working end-of-line. C-a
    -- has no such collision, so Cmd+LeftArrow stays on it.
    { key = "LeftArrow",  mods = "ALT", action = act.SendKey { key = "b", mods = "ALT" } },
    { key = "RightArrow", mods = "ALT", action = act.SendKey { key = "f", mods = "ALT" } },
    { key = "Backspace",  mods = "ALT", action = act.SendKey { key = "w", mods = "CTRL" } },
    { key = "LeftArrow",  mods = "CMD", action = act.SendKey { key = "a", mods = "CTRL" } },
    { key = "RightArrow", mods = "CMD", action = act.SendKey { key = "End" } },
    { key = "Backspace",  mods = "CMD", action = act.SendKey { key = "u", mods = "CTRL" } },

    -- Option+Enter inserts a line break instead of WezTerm's default (toggle
    -- full screen). It sends a bare line-feed -- the same \n that the daemon's
    -- \r->\n substitution uses to type a review without submitting: Enter still
    -- sends \r and submits, Option+Enter only opens a new line in the input box.
    { key = "Enter", mods = "ALT", action = act.SendString("\n") },
  },
}
