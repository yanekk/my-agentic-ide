# agentic-ide

A terminal cockpit for reviewing what `claude agents` produce. Entering an agent
in the fleet view swaps in that agent's **own two panes** — its own revdiff on its
own worktree, and its own private shell. Both keep running while you are
elsewhere, so switching away and back resumes them mid-flight: nothing is retyped
and no diff is reparsed, which is what makes a return instant. Review comments
come back as a prompt typed into the agent's input box, left **unsent** so the
wording can be edited first.

```
┌──────────────────────────────────────────────────┐
│  revdiff — the attached agent's diff              │  42%
├─────────────────────────┬───────────────────┬────┤
│  claude agents (fleet)  │ shell @ worktree  │list│  58%
├─────────────────────────┴───────────────────┴────┤
│  ⌥t new · ⌥[ ⌥] switch · ⌥w close   (key legend)  │  1 row
└──────────────────────────────────────────────────┘
```

Each agent has **many** terminals, not one — VSCode's terminal-tab model. The
narrow strip on the right edge lists them and marks the active one; `⌥t` opens
another, `⌥[` / `⌥]` cycle, `⌥w` closes. Every terminal of every agent keeps
running while parked, so all of them resume mid-flight on a return, not just the
one that was on screen. A thin full-width **footer** along the bottom always shows
that key legend, so the gestures are discoverable without memorising them.

The diff has **three modes**, toggled with the same `⌥[` / `⌥]` — but only while the
**diff pane is focused**; focused on a terminal, those keys still cycle terminals.
`uncommitted` (the default) is `HEAD` → working tree, the agent's uncommitted work;
`lastcommit` is `HEAD~1` → `HEAD`, just the most recent commit; `custom` is an
arbitrary branch/SHA → working tree (`revdiff --untracked <ref>`, the same shape as
`uncommitted` against a base you name). Cycling **into** `custom` pops an ASCII
"modal" (drawn in the diff pane by `cockpit-custom-prompt.mjs`) that asks for the
ref every time, **pre-filled** with that agent's last one; a ref git cannot resolve
re-shows the prompt with an error. The mode is **per agent** and **session-only**:
each agent has its own, kept in memory, and a brand-new agent — and every agent
after a cockpit rebuild — starts at the `uncommitted` default. Toggling one agent's
mode never touches another's. Only the custom **ref** is persisted (per agent, to
`~/.claude/cockpit/custom-refs.json`), so re-entering `custom` pre-fills the last
branch/SHA even though the mode itself resets.

Host is **WezTerm** — terminal and multiplexer in one, chosen for its pane-
targeting CLI (`wezterm cli send-text --pane-id N --no-paste`), which is what
makes typing-without-submitting possible.

## Working agreements

- **Work in the main checkout.** Do not create git worktrees unless explicitly
  asked. (`.claude/settings.json` disables background-session auto-isolation so
  this holds for background jobs too.)
- Commit to `main` directly unless a PR is asked for, and **push it**. This is
  a private repo that sets up one person's development environment: there is no
  shared branch to protect, and an unpushed commit is just work waiting to be
  lost with the machine.
- `.claude/worktrees/` is gitignored — agent worktrees live there and must not
  appear in reviews.

## Running it

Once per machine: `bin/install.sh`. It checks the five tools, records where this
checkout is and which projects root to open in, and points `~/.wezterm.lua` here.
`--start-dir ~/git` for a machine that keeps repos somewhere else; re-runs
remember it. It never replaces a `~/.wezterm.lua` of your own without `--force`.

After that, just open WezTerm. `~/.wezterm.lua` symlinks to `wezterm/cockpit.lua`,
whose `default_prog` builds the layout, starts the daemon, and launches the fleet
view. Re-opening the window is the supported way to rebuild everything.

```
bin/install.sh          per-machine setup: prerequisites, config.lua, the symlink
bin/cockpit-layout.sh   splits panes (incl. the strip), records ids, starts daemon
bin/cockpitd.mjs        follows the fleet view, retargets panes, injects reviews
bin/cockpit-strip.mjs   renders the terminal list (strip) and key legend (footer)
bin/cockpit-welcome.mjs renders the diff pane's welcome screen (shown at the fleet list)
bin/cockpit-custom-prompt.mjs  the ASCII branch/SHA prompt for the "custom" diff mode
wezterm/cockpit.lua     window config; default_prog is the layout script
spikes/cockpit-test/    integration test, wezterm stubbed (80 assertions)
spikes/pty-inject/      PTY harness used to settle how injection behaves
spikes/pane-swap/       headless-mux probes: swapping the full-width diff pane,
                        and why the footer would not stay one line high
docs/cockpit.md         how it works and why; read before changing the daemon
```

Sources for the measured claims: `docs/cockpit.md`, `spikes/pty-inject/RESULTS.md`
(injection, per-agent terminals) and `spikes/pane-swap/RESULTS.md` (the diff slot,
the footer's height).

State lives in `~/.claude/cockpit/`: `config.lua` (from the installer -- the one
file that is *not* regenerated), `panes.json` (now records the `strip` and `foot`
panes too), `fleet.log`, `daemon.log`, `review-<jobId>.md`, `terminals.json` (what
the strip and footer render — carries the visible agent's own `diffMode` and, in
custom mode, its `customRef`), `custom-refs.json` (the
per-agent branch/SHA for custom mode — the *only* persisted diff state; the mode
itself is per-agent and in-memory, so there is no `diff-mode` file any more),
`custom-ref-pending` (the handoff file the
custom prompt writes and the daemon reads), and `cmd` (the command channel
the terminal keybindings append to — the custom prompt appends `custom-ok`/
`custom-cancel` here too). Debug with `tail -f ~/.claude/cockpit/daemon.log`.

## Things that are true because they were measured

Do not "simplify" these away — each was found by getting it wrong first. Sources
in `docs/cockpit.md`, `spikes/pty-inject/RESULTS.md` and
`spikes/pane-swap/RESULTS.md`.

| | |
|---|---|
| `\r` → `\n` on every injected payload | `\r` is what Enter sends and **submits**; `\n` only inserts a newline. This one substitution is why a review can arrive unsent. |
| Never type unless attached to an agent | The fleet **list**'s prompt box dispatches a **new agent**; a review typed there would spawn one. |
| `revdiff --untracked` always | `git diff` omits untracked files and agents create new files constantly — without it, new files are invisible. |
| Diff range is `HEAD`, passed symbolically | `revdiff --untracked HEAD` diffs `HEAD` → working tree, so the review is the agent's **uncommitted** work and a clean tree shows an empty diff — it matches what the agent sees from `git status`. Passing `HEAD` (not a resolved SHA) means a reload re-reads it, so committing work drops it out of the diff instead of pinning it. A merge-base base was tried first (see the old R3) but froze at launch: it kept showing committed work forever, and on an agent sitting on the trunk it degenerated to `HEAD` anyway. |
| Watch the review file's **directory** | revdiff flushes atomically (write temp + rename), so the path gets a new inode each time and a file watch goes deaf after one flush. |
| Reviews trigger on mtime+size, not content | `O` is an explicit "send this" gesture, so pressing it twice must inject twice even if nothing changed. |
| `--no-confirm-reload` deliberately **not** passed | So an auto-reload with unflushed annotations prompts instead of silently discarding them. |
| `--no-confirm-discard` **is** passed, and a quit revdiff is reinstated | Opposite call to `--no-confirm-reload`, for the opposite reason: `R` fires *automatically*, so it must prompt; Shift+Q (`discard_quit`) is an *explicit human* "throw all annotations away" gesture, so the confirm is just friction. To stop Q from leaving the diff pane at a bare shell, `healQuitDiff` watches the attached agent's diff pane and relaunches revdiff on the same range the moment it drops to a shell — so Q reads as "clear all annotations and keep reviewing". Cooldown-guarded (`DIFF_RELAUNCH_COOLDOWN_MS`): revdiff looks like a shell for ~1s while it paints, and relaunching in that gap would type the command into a starting revdiff where every key is a binding. |
| Splits name their program explicitly | They would otherwise inherit `default_prog` and re-run the layout script forever. |
| The checkout's path is recorded, not derived | A symlinked `~/.wezterm.lua` makes `wezterm.config_file` report the **symlink**, so the config cannot locate its own repo. It used to guess `~/src/agentic-ide`, which is wrong for any other clone name or projects root. `bin/install.sh` writes both paths to `~/.claude/cockpit/config.lua`; the old guesses remain as fallbacks so an un-installed checkout still runs. |
| Layout failures `exec` a shell, never exit | As `default_prog` it is the window's only pane; exiting closes the window and takes the error message with it. |
| Agent **diffs** are moved too, never restarted | Starting revdiff costs seconds of git and parsing, which used to be paid on every switch — the top of the cockpit went blank and redrew. A parked revdiff comes back with its selected file, scroll position and unflushed annotations, so a return types nothing at all. |
| The diff slot swaps in the **opposite order** to the terminal slot | The diff pane spans the window, so its geometry *is* the slot. Park it first and the only thing left to split is the fleet pane's half-width region — revdiff comes back at 59 of 120 columns. Split the incoming pane *into* the outgoing one and dispose of the outgoing one afterwards; the split collapses and the incoming pane inherits the full slot. |
| Rebuilding an empty diff slot parks the **terminal** first | Same reason. With the fleet pane alone in the tab, `split-pane --top` spans the window; the terminal is then moved back. |
| Parked diffs keep their worktree watcher | Otherwise instant switching would just mean instantly showing a stale diff. The pane reloads in the background and is current when it returns. |
| Never send `R` while the annotation editor is open | revdiff reads every keystroke as comment text, so `R` lands *in* the comment (`comment on A` → `comment on AR`). Detected by its footer, `[enter] save`. On a visible pane you would see it; in a parked one you would not. |
| "Is revdiff running" takes **two** signals | The pane title becomes `revdiff` but lags the launch by ~1s, longer after a move. Believing a stale `bash` retypes the whole command into a live revdiff, where every character is a keybinding. So the framed screen (19 lines starting with `│`, 0 at a prompt) is counted too; either signal is enough. |
| Agent terminals are **moved**, never respawned | `move-pane-to-new-tab` parks the outgoing pane and `split-pane --move-pane-id` brings the incoming one back. WezTerm never tears the PTY down, so a `sleep 60` left running has ~30s left when you return 30s later. Measured: a 1/s counter accrued 21 ticks while its pane sat parked. |
| The terminal slot swaps like the diff slot, **not** by splitting the fleet pane | Once the strip sits on the terminal's right edge, `split-pane --pane-id <fleet>` no longer lands full-width in the slot. The incoming terminal is split **into the outgoing one** and the outgoing is parked afterwards, so it inherits the exact slot regardless of the fleet/strip neighbours. Measured against a headless mux: active terminal returns at 47 cols, strip at 12, fleet at 59. |
| The strip is **never parked** | It is a pure display pane (`cockpit-strip.mjs` renders `terminals.json`); it stays on the right edge for every agent. A diff-slot rebuild is the one exception — it parks the terminal *and* the strip so the full-width split can come off the fleet pane alone, then moves both back. |
| Terminal gestures go through the **daemon**, never a raw split | `⌥t`/`⌥[`/`⌥]`/`⌥w` append a verb to `~/.claude/cockpit/cmd`; the daemon owns every pane swap. A direct `SplitPane` keybinding (what `⌥t` used to be) makes an untracked pane the daemon then shuffles around it. |
| Closing the **last** terminal is refused | The slot must always hold a terminal; `⌥w` on a lone terminal is a no-op, logged. |
| The key legend is a **footer pane**, not a status bar | WezTerm's status bar lives in the tab bar, which is off (parked terminals live in tabs). So the legend is a thin full-width pane split off the bottom *first*, while the fleet pane still fills the window — every later split happens above it and leaves it untouched. Pure display; the daemon never manages it. |
| The footer is split with `--cells 1`, and **pins itself back** to one row | WezTerm has no fixed-size pane: `--percent` asks for a *share* of the window, re-applied on every resize and font-size change, so the one-line legend crept taller until it ate rows of the fleet view. The pane swaps were ruled out first — diff swap, terminal swap and a full slot rebuild all leave its height alone. `--cells 1` starts it right; `cockpit-strip.mjs` puts it back when it drifts. |
| Shrinking the footer means **borrowing focus**, because `adjust-pane-size --pane-id` is ignored | wezterm 20240203 resizes whatever pane is *active*. Aimed at the footer from elsewhere it squashed the **bottom row** — fleet, terminal, strip — to one line instead. So the footer focuses itself, shrinks, and hands focus straight back to the pane that had it. Over-shrinking is clamped, and only its own boundary moves, so the daemon still owns every pane swap. |
| Each drift height is corrected **once** | Focus is borrowed for ~100ms per attempt. A drift that cannot be fixed (no `wezterm` on PATH, a pane at its minimum) must not steal focus again on every 2s tick — only a *new* height is worth another go. Debounced 250ms so a window drag is corrected once, at the size it settles at. |
| The tab bar is **off** (`enable_tab_bar = false`) | Parked terminals live in tabs of the cockpit window. Clicking one would fill the window with a bare shell and look exactly like the cockpit had vanished. |
| Parking re-activates the cockpit tab | In the GUI the newly created tab becomes the active one, which would swap the whole cockpit off screen. |
| Reaping a terminal needs **two** consecutive misses | One failed `claude agents` read must not be enough to kill a shell with someone's build running in it. |
| `⌥[` / `⌥]` route by **which pane is focused** | The keys append `next`/`prev` to `cmd` unconditionally; the daemon reads the cockpit tab's active pane (`is_active`) and sends them to the diff-mode switch when the **diff** pane holds focus, to the terminal cycler otherwise. `⌥t`/`⌥w` are always terminals. |
| Switching diff mode **restarts** revdiff (`q` then relaunch) | `R` only reloads the *same* range, so changing the range means quitting revdiff back to its shell and relaunching with the new args. Never while the annotation editor is open — `q` and the whole command would land in the comment (same rule as auto-reload). |
| The diff mode is **per agent**, in-memory, defaulting to `uncommitted` | `diffModeByAgent` (jobId → mode) holds each agent's own choice; absent means the default, so a brand-new agent — and every agent after a cockpit rebuild — opens in `uncommitted` and is never carried into whatever mode another agent was left in. There is no global `diff-mode` file. Only the custom **ref** persists (`custom-refs.json`), so re-entering `custom` pre-fills the last branch/SHA even though the mode resets. |
| A parked diff is relaunched on return **only if its own mode/ref changed** | `diffLaunchedMode`/`diffLaunchedRef` record what a parked pane was launched with. Because the mode is per-agent and can only change while the agent is *attached*, a parked pane's stored mode/ref cannot drift under it — so it essentially always comes back untouched, which is the whole point of parking. The comparison stays as a correctness backstop. |
| The custom prompt is a **script in the diff pane**, handing back through `cmd` | There is no channel for free-form user text: `cmd` carries only fixed verbs and the daemon otherwise only ever *writes* into panes. So `custom` mode quits revdiff and types `cockpit-custom-prompt.mjs` into the same pane; the prompt reads the ref off its own TTY, validates it with `git rev-parse` against the agent's worktree, then appends `custom-ok`/`custom-cancel` to `cmd` for the daemon to relaunch revdiff. |
| While the prompt is open, `healQuitDiff` is **suppressed** and `⌥[`/`⌥]` are swallowed | The prompt is a plain node process, so `diffPaneStatus` reads it as a bare `shell` — indistinguishable from a quit revdiff. Without the `customPromptOpen` guard the 1s healer (and any further mode-cycle keypress) would type revdiff *over* the live prompt, where every character is an editor keystroke. The prompt owns the pane until it resolves; Enter confirms, Esc cancels back to the previous mode. |
| Cycling **into** custom always re-prompts; switching **agents** does not | Answer to "ask me each time": the prompt fires on the `⌥[`/`⌥]` transition *into* `custom`, pre-filled with the agent's stored ref. Attaching to a different agent while already in `custom` is not "entering the mode" — it reuses that agent's stored ref silently, and only prompts if the agent has none yet (it cannot diff against nothing). |
| A terminal is `cd`'d forward when its agent **changed directory**, but only if **idle and untouched** | An agent's `cwd` migrates — it can start in the checkout and later create and enter a worktree — but a terminal is spawned once and thereafter only moved between tabs, never re-`cd`'d, so it freezes at the old directory (revdiff self-heals via its relaunch/reload path; a shell has none). `termSpawnCwd` records where each shell was put; on return, if the agent has moved and the shell is still sitting at its spawn cwd (untouched — checked against WezTerm's reported `cwd`) **and** idle (foreground process is the login shell, via `ps -t`), a `cd` is typed in. A shell the user navigated or one with a job running is left alone — a stray `cd` mid-command is worse than a stale prompt. |

## How agent switching is detected

The fleet pane renders the attached agent's name in its own header
(`──── some agent name ─`), and the cockpit owns that pane, so
`wezterm cli get-text` reads it and `claude agents --json` maps the name to a job
id and live worktree. That poll is the **source of truth**; the undocumented
`[FV-attach]` line in `--debug-file` is only a latency hint.

`~/.claude/daemon/attach-journal/` is **not** usable for this — it records a
gestureId, pid and timings but no job id, cwd or name, so it can say *that*
something was attached, never *which*.

## Known limits

- Agent names must be unique to resolve from the pane header; ambiguity is logged
  and the panes are left alone rather than pointed at a guess.
- Agent panes live and die with the cockpit **window**. Closing it kills every
  agent terminal and every agent's revdiff; nothing survives a rebuild.
  (Deliberate — the alternative is a detached-session multiplexer between you and
  every shell.)
- A parked pane is resized to the full tab and back, so it takes two SIGWINCHes
  per switch. Line-oriented output does not care; revdiff reflows and redraws —
  nothing is lost, but the redraw is visible.
- Unflushed annotations are invisible to the daemon, so auto-reload's "have you
  started commenting?" check is based on the flushed file.
- One agent at a time, by design.
