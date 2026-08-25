# agentic-ide

A terminal cockpit for reviewing what `claude agents` produce.

One WezTerm window, three panes: the agent's diff across the top, the fleet list
bottom-left, the agent's own shell bottom-right. Read the diff, annotate it,
press **Shift+O** — the review lands in that agent's prompt box, unsent, with
the cursor already there.

```
┌──────────────────────────────────────────────────┐
│  revdiff — the attached agent's diff              │  42%
├─────────────────────────┬───────────────────┬────┤
│  claude agents (fleet)  │ shell @ worktree  │list│  58%
├─────────────────────────┴───────────────────┴────┤
│  ⌥t new · ⌥[ ⌥] switch · ⌥w close   (key legend)  │  1 row
└──────────────────────────────────────────────────┘
```

## Why this exists

I stopped writing the code. The agents write it; my job is to read what came
back and say what's wrong with it.

That made most of VSCode dead weight — LSPs, debugger, refactoring, extensions
all serve typing code into a file. And it couldn't show the one thing I wanted:
its window is bound to a folder, the agents work in worktrees, so their changes
landed outside the tree it had open and source control stayed empty. Reviewing
meant commit, push, read the diff on BitBucket — committed work only, through a
remote, to see files on the same disk. Then hand-copy the comment back into the
terminal.

So: read the diff, comment back, one keystroke between them. Not an IDE.
`docs/requirements.md` has the interview behind it.

## The three panes

The layout is fixed, not a workspace you arrange:

- **Top — the diff.** `revdiff --untracked HEAD` on the agent's worktree: its
  *uncommitted* work, so a clean tree shows an empty diff. Auto-reloads as the
  agent writes; stops the moment you start annotating.
- **Bottom-left — the fleet.** `claude agents`. Entering one here is the only
  navigation gesture; the other panes follow.
- **Bottom-right — that agent's own shell**, in its worktree — a set of them,
  VSCode-style: `⌥t` new, `⌥[` / `⌥]` cycle, `⌥w` close, listed in the strip on
  the right edge.

Switching agents **moves** these panes, never restarts them: every terminal and
revdiff keeps running while parked, holding its scroll position and unflushed
annotations, so a return is instant.

With no agent attached the top pane shows a greeting and a **notes** column.
`note "rebase before the PR"` adds, bare `note` lists, `note edit|rm a3f9`
changes. Cockpit terminals only — agents have it too, and their notes carry
their name.

## Shift+O — the whole review loop

1. Enter an agent in the fleet list. Diff and terminal retarget themselves.
2. Read. Press `a` on a line to annotate, type the comment, `Enter`.
3. Press **`O`** (Shift+O): the annotations become a prompt, **typed into the
   agent's prompt box without submitting it**, and focus jumps to that pane.
4. Edit the wording, then press Enter yourself. Or don't send it.

The unsent part is why the host is WezTerm: `wezterm cli send-text --no-paste`
writes into another pane's PTY, with every `\r` turned into `\n` — `\r` is what
Enter sends and would submit it. The focus jump rides on the same key because
`O` is revdiff's own flush key, so a successful flush runs its
`--post-flush-command`. `O` stays an ordinary letter everywhere else.

### Diff modes

With the **diff pane** focused, `⌥[` / `⌥]` cycle what's being diffed (focused
on a terminal, they cycle terminals):

| mode | range |
|---|---|
| `uncommitted` (default) | `HEAD` → working tree — the agent's uncommitted work |
| `lastcommit` | `HEAD~1` → `HEAD` — just the most recent commit |
| `custom` | an arbitrary branch/SHA → working tree |

Cycling into `custom` prompts for the ref, pre-filled with that agent's last
one. The mode is per agent and session-only; only the custom ref persists.

### Keys

| key | does |
|---|---|
| `O` | flush the review into the agent's prompt box, unsent, and focus it |
| `a` / `Enter` | annotate the selected line (revdiff) |
| `R` / `Shift+Q` | reload the diff / drop all annotations and keep reviewing |
| `⌥t` | new terminal for this agent |
| `⌥[` `⌥]` | cycle terminals — or diff modes, if the diff pane is focused |
| `⌥w` | close terminal (refused on the last one) |
| `⌘⌥`+arrows | move focus between panes |
| `⌥z` | zoom the focused pane |

## Installation

macOS, plus `wezterm` (`brew install --cask wezterm`), `revdiff` (`brew tap
umputun/apps && brew install revdiff`), `node`, `git`, and
[`claude`](https://claude.com/product/claude-code). Then once per machine:

```bash
bin/install.sh                    # or: bin/install.sh --start-dir ~/git
```

Idempotent; `--check` reports without writing. It verifies the tools through a
**login shell** (the PATH a GUI-launched WezTerm actually gets), records this
checkout and the projects root in `~/.claude/cockpit/config.lua`, and points
`~/.wezterm.lua` at `wezterm/cockpit.lua` — never replacing one of your own
silently (`--force`, or `--no-link` plus `wezterm --config-file
<checkout>/wezterm/cockpit.lua start`).

Then just open WezTerm: `default_prog` builds the panes, starts the daemon and
brings up the fleet. Re-opening the window is the rebuild path, and deliberately
cheap — the agents are daemon-backed and survive it, their terminals and diffs
do not.

## Known limits

- Agent names must be unique to resolve from the fleet pane's header; ambiguity
  is logged and the panes left alone.
- Closing the window kills every agent terminal and diff. Deliberate — the
  alternative is a detached-session multiplexer between you and every shell.
- A parked pane is resized to the full tab and back, so revdiff visibly redraws
  on return — nothing is lost. One agent at a time, by design.
