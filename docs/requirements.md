# Requirements — multi-agent review cockpit

Captured 2026-08-23 from interview. Ordered by how strongly they constrain the solution.

## The job to be done

Work with 2–4 `claude agents` at a time, one at a time, each in its own git worktree.
Entering an agent should bring the whole working context with it: the diff to review and
a terminal already in that worktree. Leaving it should put the context back.

**Crucially: this is a review surface, not an IDE.** The only two activities are
*read the diff* and *comment back to the agent*. No hand-editing, no LSP, no debugger,
no test-running-as-primary-workflow. Requirements that would follow from "I need an
editor" (extension ecosystem, refactoring, language support) do **not** apply.

## Hard requirements

| # | Requirement | Notes |
|---|---|---|
| R1 | **One window, three panes.** Top: diff, full width. Bottom-left: `claude agents`. Bottom-right: terminal scoped to the current agent's worktree, with a *list* of terminals on its right edge and a way to add more (VSCode's terminal-tab UX). | The layout is specified, not approximate. |
| R2 | **Auto-follow on attach.** Entering an agent in the fleet TUI must switch the diff and the terminal cwd with no user action. | Signal is solved — see `research/claude-agents-watching.md`. |
| R3 | **Diff = merge-base → now.** Cumulative agent contribution: worktree commits *plus* uncommitted changes, against the branch point with main. | Not `git diff`, not per-commit. |
| R4 | **Live diff.** Updates as the agent writes files. | Watch the worktree; refresh continuously. |
| R5 | **Comment → prompt, pre-filled unsent.** Comments anchored to file:line, composed into a prompt, and *typed into the agent's prompt box without submitting* so the wording can be edited before send. | This is the sharpest constraint — see below. |
| R6 | 2–4 concurrent agents, strictly one at a time. No side-by-side comparison. | Single-context model is safe. |
| R7 | No vim/neovim/tmux background. VSCode only. | Modal editing and multiplexer config carry real learning cost. |
| R8 | **Lightweight.** | Added 2026-08-23 after trying Conductor: it was too heavy. |
| R9 | **Monospaced throughout**, including UI chrome. | Rules out any GUI with proportional-font UI — VSCode's tabs, sidebars and comment threads included. |
| R10 | **Keyboard-controlled.** | Mouse-optional, not mouse-first. |

## Explicit non-requirements

- **Fleet session durability.** If the surrounding app restarts, relaunching
  `claude agents` is fine — the agents are daemon-backed and survive independently.
  *This removes the main objection to a VSCode integrated terminal.*
- Editing, debugging, language intelligence in the agent's worktree.
- Reviewing two agents simultaneously.
- GitHub round-trip. Comments stay local.

## Field notes

**Conductor, tried 2026-08-23 — rejected.** Too heavy, not monospaced, not
keyboard-first, and it brings its own harness. The `claude agents` model is
actively preferred, not merely incumbent. This closes Path A (replacing the fleet
with an orchestrator) for good and produced R8–R10 above.

## Build appetite

Unbounded — optimise for the end experience, accept the build cost that implies.
A purpose-built app is on the table; so is an editor plugin.

## Why R5 dominates the design

"Pre-filled but unsent" means writing bytes into the fleet TUI's input box **without a
carriage return**. That is only possible if the surrounding app *owns the PTY* that
`claude agents` runs in:

- VSCode: `terminal.sendText(text, false)` — sends without newline. Exact fit.
- Custom app on node-pty: `pty.write(text)` — exact fit.
- External terminal the app doesn't own: needs a multiplexer (`tmux send-keys -l`,
  `wezterm cli send-text --no-paste`) or it is impossible.

So the candidate set is bounded to: hosts that can own a PTY *and* render a diff with
anchored comments *and* control pane layout.
