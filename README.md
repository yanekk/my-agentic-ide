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
  navigation gesture; the other panes follow. When `pir` is installed the slot
  can also hold its dashboard: plain ← at the list, with the box empty, opens a
  small picker of the two, and under each it lists what that program has
  going, whatever is waiting for you first, so you see where you are needed
  before you switch
  (`plans/fleet-picker-status/`). Failures stay until dismissed; clean finishes
  show for an hour, though pir's will only once pir reports when a run ended.
- **Bottom-right — that agent's own shell**, in its worktree — a set of them,
  VSCode-style: `⌥t` new, `⌥[` / `⌥]` cycle, `⌥w` close, listed in the strip on
  the right edge.

Switching agents **moves** these panes, never restarts them: every terminal and
revdiff keeps running while parked, holding its scroll position and unflushed
annotations, so a return is instant.

With no agent attached the top pane shows a greeting and, down the right, a
**notes** column over **today's calendar**. `note "rebase before the PR"` adds,
bare `note` lists, `note edit|rm a3f9` changes. Cockpit terminals only — agents
have it too, and their notes carry their name.

Below the notes, `agenda` shows what is **left** of the day across your Google
calendars — the meeting you are in pinned at the top as `NOW` with when it lets
you go, rolling on to tomorrow once today empties. `agenda add work` signs in and
attaches one calendar, picked from a list. The daemon refreshes it every minute;
lose the network and the events stay with one dim line saying how old they are.
Agents may read it, but not connect one.

A calendar you mark as a **jobs calendar** (`agenda add nightly --jobs`) starts work
while you are away: an entry titled `project / item name`, like
`superfrog-re / run nightly tests`, starts one background Claude in that project folder
at the entry's start time, with the entry's description as its instructions. It works in its own worktree and its final message in `claude agents`
is the report. **The cockpit window must stay open**: nothing starts while it is closed.
An entry that could not start leaves one line in the notes column.

Nothing stops to ask, and the machine holds these agents inside a **wall**. It refuses
writes outside the worktree, moving a branch that already exists, a push, reading
`~/.ssh`, `~/.aws`, the GitHub and Claude logins, the keychain and the cockpit's own
folder, every site except npm and PyPI, web fetches, connectors and messages to other
sessions. A start that cannot be confined does not run. The `scheduled-run` skill tries
a job inside the wall before it writes the entry, and only you can add an exception,
per project, with `agenda wall <project> allow-site|allow-ports|allow-write`. A job
that hits a block carries on and lists it in its report.

The wall is not a promise against a determined attacker. It does not cover reading the
rest of the machine, temporary folders, data sent to an allowed site, tags, unreachable
git objects, branches created after the run began, or what the commits do once merged.
Your other sessions have no wall and can edit the exceptions list. Apple Events to apps
already running were only weakly measured. Resuming a run by hand with `claude --bg
--resume {id}` drops the wall, and a run cannot use the GPU. A later Claude version
could ignore the settings: the results are for Claude Code 2.1.316, which updates
itself, and `spikes/calendar-jobs-test/wall-check.sh` is the recheck you run by hand. It
shows Claude took the settings, a job completes and an unlisted site is blocked; it does
not re-prove the refused secret reads, push or branch moves, measured once on real agents.

After merging a change to this, run `bin/install.sh`, reopen the window, then add any
exceptions. See [`docs/cockpit.md`](docs/cockpit.md#agents-started-from-a-calendar).

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

The agenda is **optional and set up separately**, because it needs a Google
client ID you create once in the Google Cloud console. `agenda setup
~/Downloads/client_secret_….json` takes the file Google gives you; then `agenda
add home` per calendar. Nothing secret is in this repository — the registration
and the sign-ins live in `~/.claude/cockpit/`, mode `0600`. With no calendars
configured the feature costs nothing: the daemon's tick returns immediately and
the column falls back to notes alone. `docs/cockpit.md` has the two console
traps that will otherwise bite you.

`docs/cockpit.md` covers how it works and why — read it before changing the
daemon.

## Known limits

- Agent names must be unique to resolve from the fleet pane's header; ambiguity
  is logged and the panes left alone.
- Closing the window kills every agent terminal and diff. Deliberate — the
  alternative is a detached-session multiplexer between you and every shell.
- A parked pane is resized to the full tab and back, so revdiff visibly redraws
  on return — nothing is lost. One agent at a time, by design.
