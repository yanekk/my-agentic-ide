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
│  revdiff — the attached agent's diff              │  55%
├─────────────────────────┬───────────────────┬────┤
│  claude agents (fleet)  │ shell @ worktree  │list│  45%
└─────────────────────────┴───────────────────┴────┘
```

Each agent has **many** terminals, not one — VSCode's terminal-tab model. The
narrow strip on the right edge lists them and marks the active one; `⌥t` opens
another, `⌥[` / `⌥]` cycle, `⌥w` closes. Every terminal of every agent keeps
running while parked, so all of them resume mid-flight on a return, not just the
one that was on screen.

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
bin/cockpit-strip.mjs   renders the per-agent terminal list in the right-edge pane
wezterm/cockpit.lua     window config; default_prog is the layout script
spikes/cockpit-test/    integration test, wezterm stubbed (55 assertions)
spikes/pty-inject/      PTY harness used to settle how injection behaves
spikes/pane-swap/       headless-mux probe for swapping the full-width diff pane
docs/cockpit.md         how it works and why; read before changing the daemon
```

Sources for the measured claims: `docs/cockpit.md`, `spikes/pty-inject/RESULTS.md`
(injection, per-agent terminals) and `spikes/pane-swap/RESULTS.md` (the diff slot).

State lives in `~/.claude/cockpit/`: `config.lua` (from the installer -- the one
file that is *not* regenerated), `panes.json` (now records the `strip` pane too),
`fleet.log`, `daemon.log`, `review-<jobId>.md`, `terminals.json` (the strip's
render source), and `cmd` (the command channel the terminal keybindings append
to). Debug with `tail -f ~/.claude/cockpit/daemon.log`.

## Things that are true because they were measured

Do not "simplify" these away — each was found by getting it wrong first. Sources
in `docs/cockpit.md`, `spikes/pty-inject/RESULTS.md` and
`spikes/pane-swap/RESULTS.md`.

| | |
|---|---|
| `\r` → `\n` on every injected payload | `\r` is what Enter sends and **submits**; `\n` only inserts a newline. This one substitution is why a review can arrive unsent. |
| Never type unless attached to an agent | The fleet **list**'s prompt box dispatches a **new agent**; a review typed there would spawn one. |
| `revdiff --untracked` always | `git diff` omits untracked files and agents create new files constantly — without it, new files are invisible. |
| Diff range is a bare merge-base commit | `revdiff [base] [against]` defaults `against` to the working tree, so this spans committed *and* uncommitted work. `main...HEAD` misses the uncommitted part. |
| Merge base is discovered, not `main` | Agents branch from wherever they started: `@{upstream}`, then `origin/HEAD`, then `main`, then `master`. |
| Watch the review file's **directory** | revdiff flushes atomically (write temp + rename), so the path gets a new inode each time and a file watch goes deaf after one flush. |
| Reviews trigger on mtime+size, not content | `O` is an explicit "send this" gesture, so pressing it twice must inject twice even if nothing changed. |
| `--no-confirm-reload` deliberately **not** passed | So an auto-reload with unflushed annotations prompts instead of silently discarding them. |
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
| The tab bar is **off** (`enable_tab_bar = false`) | Parked terminals live in tabs of the cockpit window. Clicking one would fill the window with a bare shell and look exactly like the cockpit had vanished. |
| Parking re-activates the cockpit tab | In the GUI the newly created tab becomes the active one, which would swap the whole cockpit off screen. |
| Reaping a terminal needs **two** consecutive misses | One failed `claude agents` read must not be enough to kill a shell with someone's build running in it. |

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
